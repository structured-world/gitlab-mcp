/**
 * Checks a plugin package against the Agent Plugins 1.0.0 schemas and the
 * OpenAI directory submission rules that can be verified offline.
 */

import { isIP } from 'node:net';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import { parse as parseYaml } from 'yaml';

export type PluginFlavor = 'public' | 'private';

/** One file of the package, keyed by its plugin-relative path. */
export type PackageFiles = ReadonlyMap<string, Buffer>;

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MIN_ICON_PX = 48;
const MAX_RASTER_PX = 4096;
const MAX_URL_LENGTH = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Submission refuses these in a directory ZIP: app references and lifecycle hooks.
const FORBIDDEN_PATHS = [/^\.app\.json$/, /^hooks\//, /^\.codex-plugin\//, /^\.mcp\.json$/];

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['GitLab token', /\bgl(?:pat|oas|dt|rt|cbt|ptt|ft|imt|agent|soat|ffct)-[0-9A-Za-z_-]{20,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];

// A local absolute path in a published file ties it to one machine. The
// lookbehind skips the same words as segments of a web URL path; a Windows
// path may be written with JSON-escaped backslashes.
const LOCAL_PATH_PATTERN =
  /(?<![\w.~-])(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})[^\s"'`]+/;

const SEMVER_NUMBER = /^(?:0|[1-9]\d*)$/;
const SEMVER_IDENTIFIER = /^[0-9A-Za-z-]+$/;

/** Semantic Versioning 2.0.0: MAJOR.MINOR.PATCH, optional prerelease and build metadata. */
function isSemVer(version: string): boolean {
  const plus = version.indexOf('+');
  const build = plus === -1 ? undefined : version.slice(plus + 1);
  const rest = plus === -1 ? version : version.slice(0, plus);
  const dash = rest.indexOf('-');
  const prerelease = dash === -1 ? undefined : rest.slice(dash + 1);
  const core = (dash === -1 ? rest : rest.slice(0, dash)).split('.');
  // Item 2: three numbers without leading zeros.
  if (core.length !== 3 || !core.every((part) => SEMVER_NUMBER.test(part))) return false;
  // Item 9: non-empty identifiers; numeric ones without leading zeros.
  const validPrerelease = (id: string): boolean =>
    SEMVER_IDENTIFIER.test(id) && (!/^\d+$/.test(id) || SEMVER_NUMBER.test(id));
  if (prerelease !== undefined && !prerelease.split('.').every(validPrerelease)) return false;
  // Item 10: non-empty identifiers, leading zeros allowed.
  return build === undefined || build.split('.').every((id) => SEMVER_IDENTIFIER.test(id));
}

// Matches a URL in text, including a bracketed IPv6 host (RFC 3986 3.2.2), in
// any letter case: schemes are case-insensitive (RFC 3986 3.1).
const URL_IN_TEXT_PATTERN = /https?:\/\/(?:\[[0-9A-F:.]+\])?[^\s"'`<>)\]]*/gi;

/**
 * IPv4 blocks that never reach a public host, from the IANA special-purpose
 * registry (RFC 6890) plus multicast (RFC 5771) and the reserved class E
 * space with limited broadcast (RFC 1112 4, RFC 919 7).
 */
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network", RFC 1122 3.2.1.3
  ['10.0.0.0', 8], // private, RFC 1918
  ['100.64.0.0', 10], // shared address space, RFC 6598
  ['127.0.0.0', 8], // loopback, RFC 1122 3.2.1.3
  ['169.254.0.0', 16], // link-local, RFC 3927
  ['172.16.0.0', 12], // private, RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments, RFC 6890 2.2.2 (exceptions below)
  ['192.0.2.0', 24], // documentation TEST-NET-1, RFC 5737
  ['192.88.99.2', 32], // 6a44 relay anycast, RFC 6751
  ['192.168.0.0', 16], // private, RFC 1918
  ['198.18.0.0', 15], // benchmarking, RFC 2544
  ['198.51.100.0', 24], // documentation TEST-NET-2, RFC 5737
  ['203.0.113.0', 24], // documentation TEST-NET-3, RFC 5737
  ['224.0.0.0', 4], // multicast, RFC 5771
  ['240.0.0.0', 4], // reserved and limited broadcast
];

/** Addresses inside 192.0.0.0/24 the registry marks as globally reachable. */
const GLOBAL_IPV4_EXCEPTIONS: ReadonlyArray<readonly [string, number]> = [
  ['192.0.0.9', 32], // Port Control Protocol anycast, RFC 7723
  ['192.0.0.10', 32], // TURN anycast, RFC 8155
];

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function inIpv4Block(value: number, [base, prefix]: readonly [string, number]): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(ipv4ToNumber(base) / size);
}

function isNonPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (GLOBAL_IPV4_EXCEPTIONS.some((block) => inIpv4Block(value, block))) return false;
  return NON_PUBLIC_IPV4.some((block) => inIpv4Block(value, block));
}

/**
 * IPv6 blocks the IANA IPv6 Special-Purpose Address Registry marks as not
 * globally reachable, plus multicast (RFC 4291 2.7) and deprecated site-local
 * (RFC 3879). IPv4-mapped addresses are judged by their IPv4 address.
 */
const NON_PUBLIC_IPV6: ReadonlyArray<readonly [string, number]> = [
  ['::', 128], // unspecified, RFC 4291 2.5.2
  ['::1', 128], // loopback, RFC 4291 2.5.3
  ['64:ff9b:1::', 48], // local-use translation, RFC 8215
  ['100::', 64], // discard-only, RFC 6666
  ['100:0:0:1::', 64], // dummy prefix, RFC 9780
  ['2001::', 23], // IETF protocol assignments, RFC 2928 (exceptions below)
  ['2001:db8::', 32], // documentation, RFC 3849
  ['3fff::', 20], // documentation, RFC 9637
  ['5f00::', 16], // segment routing SIDs, RFC 9602
  ['fc00::', 7], // unique local, RFC 4193
  ['fe80::', 10], // link-local, RFC 4291 2.5.6
  ['fec0::', 10], // site-local, deprecated by RFC 3879
  ['ff00::', 8], // multicast, RFC 4291 2.7
];

/** Blocks inside 2001::/23 the registry marks as globally reachable. */
const GLOBAL_IPV6_EXCEPTIONS: ReadonlyArray<readonly [string, number]> = [
  ['2001::', 32], // Teredo, RFC 4380
  ['2001:1::1', 128], // Port Control Protocol anycast, RFC 7723
  ['2001:1::2', 128], // TURN anycast, RFC 8155
  ['2001:1::3', 128], // DNS-SD SRP anycast, RFC 9665
  ['2001:3::', 32], // AMT, RFC 7450
  ['2001:4:112::', 48], // AS112-v6, RFC 7535
  ['2001:20::', 28], // ORCHIDv2, RFC 7343
  ['2001:30::', 28], // drone remote ID, RFC 9374
];

/** The 128-bit value of an address `isIP` accepted as IPv6. */
function ipv6ToBigInt(address: string): bigint {
  let text = address;
  const tailStart = text.lastIndexOf(':') + 1;
  const tail = text.slice(tailStart);
  // A dotted IPv4 tail fills the last two groups (RFC 4291 2.2).
  if (tail.includes('.')) {
    const value = ipv4ToNumber(tail);
    text = `${text.slice(0, tailStart)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const zeros =
    rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].reduce(
    (value, group) => (value << 16n) + BigInt(Number.parseInt(group, 16)),
    0n,
  );
}

function inIpv6Block(value: bigint, [base, prefix]: readonly [string, number]): boolean {
  const shift = BigInt(128 - prefix);
  return value >> shift === ipv6ToBigInt(base) >> shift;
}

function isNonPublicIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  // IPv4-mapped, ::ffff:0:0/96 (RFC 4291 2.5.5.2).
  if (value >> 32n === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    return isNonPublicIpv4([24, 16, 8, 0].map((shift) => (ipv4 >>> shift) & 255).join('.'));
  }
  if (GLOBAL_IPV6_EXCEPTIONS.some((block) => inIpv6Block(value, block))) return false;
  return NON_PUBLIC_IPV6.some((block) => inIpv6Block(value, block));
}

/**
 * Domains that, with every subdomain, never resolve in public DNS: the IANA
 * Special-Use Domain Names registry (RFC 6761) plus names reserved for private
 * networks. example.com, example.net and example.org are not listed: they do
 * resolve publicly (RFC 6761 6.5).
 */
const NON_PUBLIC_DOMAINS = [
  'localhost', // RFC 6761 6.3
  'invalid', // RFC 6761 6.4
  'test', // RFC 6761 6.2
  'example', // RFC 6761 6.5
  'local', // multicast DNS, RFC 6762
  'onion', // Tor, RFC 7686
  'alt', // non-DNS namespaces, RFC 9476
  'home.arpa', // residential networks, RFC 8375
  'internal', // private use, reserved by ICANN
  'lan', // common private-network suffix
] as const;

export interface ValidationIssue {
  file: string;
  message: string;
}

export class PluginValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    const lines = issues.map((i) => '  ' + i.file + ': ' + i.message);
    super(['Plugin package is invalid:', ...lines].join('\n'));
    this.name = 'PluginValidationError';
  }
}

/** True for loopback, private, link-local and unique-local addresses and local names. */
export function isNonPublicHost(hostname: string): boolean {
  // A trailing root dot names the same host (RFC 1034 3.1): "localhost." is "localhost".
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (NON_PUBLIC_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) return isNonPublicIpv4(host);
  if (family === 6) return isNonPublicIpv6(host);
  // A single-label name only resolves inside a local network.
  return !host.includes('.');
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // A DNS name such as 127.example.com resolves wherever its owner points it,
  // so only a literal address in 127.0.0.0/8 counts (RFC 1122 3.2.1.3).
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
}

/**
 * Validates the MCP endpoint the package points at. Public packages need a
 * public HTTPS host; a private package may also use plain HTTP on loopback,
 * which never leaves the machine.
 */
export function validateEndpoint(raw: string, flavor: PluginFlavor): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Endpoint is not a valid URL: ${raw}`);
  }
  if (url.username || url.password) {
    throw new Error('Endpoint must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new Error('Endpoint must not carry a query or fragment');
  }
  // Reserved in the IANA service name and port registry; nothing listens there.
  if (url.port === '0') throw new Error('Endpoint port 0 is reserved');
  const plainLoopback = url.protocol === 'http:' && isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(flavor === 'private' && plainLoopback)) {
    throw new Error(
      flavor === 'public'
        ? 'Public endpoint must use HTTPS'
        : 'Endpoint must use HTTPS (plain HTTP is accepted only on loopback)',
    );
  }
  if (flavor === 'public' && isNonPublicHost(url.hostname)) {
    throw new Error(`Public endpoint host is not publicly reachable: ${url.hostname}`);
  }
  return url;
}

function checkListingUrl(issues: ValidationIssue[], field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ file: 'plugin.json', message: `${field} is required` });
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ file: 'plugin.json', message: `${field} is not a valid URL` });
    return;
  }
  if (url.protocol !== 'https:') {
    issues.push({ file: 'plugin.json', message: `${field} must use HTTPS` });
  }
  if (url.username || url.password) {
    issues.push({ file: 'plugin.json', message: `${field} must not embed credentials` });
  }
  if (value.length > MAX_URL_LENGTH) {
    issues.push({ file: 'plugin.json', message: `${field} exceeds ${MAX_URL_LENGTH} characters` });
  }
}

function checkText(issues: ValidationIssue[], field: string, value: unknown, max: number): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ file: 'plugin.json', message: `${field} is required` });
    return;
  }
  if (value.length > max) {
    issues.push({ file: 'plugin.json', message: `${field} exceeds ${max} characters` });
  }
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio of two #RRGGBB colors. */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Width and height from a PNG IHDR chunk, or undefined when the data is not a PNG. */
export function pngSize(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (data.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function checkImage(
  issues: ValidationIssue[],
  files: PackageFiles,
  field: string,
  ref: unknown,
  kind: 'icon' | 'screenshot',
) {
  if (typeof ref !== 'string') {
    issues.push({ file: 'plugin.json', message: `${field} is required` });
    return;
  }
  const path = ref.replace(/^\.\//, '');
  const data = files.get(path);
  if (!ref.startsWith('./') || !data) {
    issues.push({ file: 'plugin.json', message: `${field} does not resolve inside the package` });
    return;
  }
  if (data.length > MAX_ASSET_BYTES) {
    issues.push({ file: path, message: 'asset exceeds 5 MiB' });
  }
  const size = pngSize(data);
  if (!size) {
    issues.push({ file: path, message: 'asset must be a PNG' });
    return;
  }
  if (size.width > MAX_RASTER_PX || size.height > MAX_RASTER_PX) {
    issues.push({ file: path, message: `image exceeds ${MAX_RASTER_PX} px` });
  }
  if (kind === 'icon' && size.width !== size.height) {
    issues.push({ file: path, message: `icon must be square, got ${size.width}x${size.height}` });
  }
  if (kind === 'icon' && size.width < MIN_ICON_PX) {
    issues.push({ file: path, message: `icon must be at least ${MIN_ICON_PX} px` });
  }
}

function checkSkill(issues: ValidationIssue[], path: string, data: Buffer): void {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(data.toString('utf8'));
  if (!match) {
    issues.push({ file: path, message: 'SKILL.md has no YAML front matter' });
    return;
  }
  let header: unknown;
  try {
    header = parseYaml(match[1]);
  } catch {
    issues.push({ file: path, message: 'SKILL.md front matter is not valid YAML' });
    return;
  }
  const fields = (header ?? {}) as Record<string, unknown>;
  for (const key of ['name', 'description']) {
    const value = fields[key];
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push({ file: path, message: `SKILL.md front matter needs a ${key}` });
    }
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });

/**
 * Validates every file of the package. `schemas` holds the Agent Plugins
 * schemas; `flavor` selects the submission rules that apply only to public
 * packages.
 */
export function validatePackage(
  files: PackageFiles,
  schemas: { plugin: object; mcp: object },
  flavor: PluginFlavor,
): void {
  const issues: ValidationIssue[] = [];
  const manifest = readJson(issues, files, 'plugin.json');
  const mcp = readJson(issues, files, 'mcp.json');
  checkSchema(issues, 'plugin.json', schemas.plugin, manifest);
  checkSchema(issues, 'mcp.json', schemas.mcp, mcp);
  for (const [path, data] of files) checkFileContent(issues, path, data, flavor);
  checkSkills(issues, files);
  if (mcp) checkServers(issues, mcp, flavor);
  if (manifest) checkManifest(issues, files, manifest, flavor);
  if (issues.length > 0) throw new PluginValidationError(issues);
}

type Json = Record<string, unknown>;

function readJson(issues: ValidationIssue[], files: PackageFiles, path: string): Json | undefined {
  const data = files.get(path);
  if (!data) {
    issues.push({ file: path, message: 'missing' });
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    issues.push({ file: path, message: 'not valid JSON' });
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    issues.push({ file: path, message: 'must be a JSON object' });
    return undefined;
  }
  return parsed as Json;
}

function checkSchema(
  issues: ValidationIssue[],
  path: string,
  schema: object,
  value: Json | undefined,
): void {
  if (value === undefined) return;
  // Ajv registers a compiled schema under its $id and refuses to add it twice.
  const id = (schema as { $id?: string }).$id;
  const check = (id ? ajv.getSchema(id) : undefined) ?? ajv.compile(schema);
  if (check(value)) return;
  // Ajv fills `errors`, each with a message, whenever validation fails.
  for (const error of check.errors as ErrorObject[]) {
    issues.push({ file: path, message: `${error.instancePath || '/'} ${error.message as string}` });
  }
}

/** Forbidden paths, plus secrets, local paths and non-public URLs in text files. */
function checkFileContent(
  issues: ValidationIssue[],
  path: string,
  data: Buffer,
  flavor: PluginFlavor,
): void {
  if (FORBIDDEN_PATHS.some((pattern) => pattern.test(path))) {
    issues.push({ file: path, message: 'not allowed in a directory submission' });
  }
  if (!/\.(json|md|txt|yaml|yml)$/.test(path)) return;
  const text = data.toString('utf8');
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) issues.push({ file: path, message: `contains a ${label}` });
  }
  if (LOCAL_PATH_PATTERN.test(text)) {
    issues.push({ file: path, message: 'contains a local absolute path' });
  }
  if (flavor !== 'public') return;
  for (const found of text.matchAll(URL_IN_TEXT_PATTERN)) {
    if (isNonPublicUrl(found[0])) {
      issues.push({ file: path, message: `references a non-public URL: ${found[0]}` });
    }
  }
}

function isNonPublicUrl(text: string): boolean {
  try {
    return isNonPublicHost(new URL(text).hostname);
  } catch {
    // Not a URL after all; nothing to check.
    return false;
  }
}

function checkSkills(issues: ValidationIssue[], files: PackageFiles): void {
  const skills = [...files].filter(([path]) => /^skills\/[^/]+\/SKILL\.md$/.test(path));
  if (skills.length === 0) issues.push({ file: 'skills/', message: 'package has no skills' });
  for (const [path, data] of skills) checkSkill(issues, path, data);
}

function checkServers(issues: ValidationIssue[], mcp: Json, flavor: PluginFlavor): void {
  const servers = Object.entries((mcp.mcpServers ?? {}) as Record<string, Json>);
  // The directory connects exactly one MCP server per plugin.
  if (servers.length !== 1) {
    issues.push({ file: 'mcp.json', message: 'must declare exactly one MCP server' });
  }
  for (const [name, server] of servers) {
    if (server.headers && Object.keys(server.headers).length > 0) {
      issues.push({ file: 'mcp.json', message: `${name} must not declare headers` });
    }
    if (typeof server.url !== 'string') continue;
    try {
      validateEndpoint(server.url, flavor);
    } catch (error) {
      issues.push({ file: 'mcp.json', message: `${name}: ${(error as Error).message}` });
    }
  }
}

function checkManifest(
  issues: ValidationIssue[],
  files: PackageFiles,
  manifest: Json,
  flavor: PluginFlavor,
): void {
  checkText(issues, 'version', manifest.version, 64);
  if (typeof manifest.version === 'string' && !isSemVer(manifest.version)) {
    issues.push({
      file: 'plugin.json',
      message: 'version must be a Semantic Versioning 2.0.0 version',
    });
  }
  checkText(issues, 'description', manifest.description, 4000);
  const author = (manifest.author ?? {}) as Json;
  checkText(issues, 'author.name', author.name, 120);
  if (author.url !== undefined) checkListingUrl(issues, 'author.url', author.url);
  if (manifest.homepage !== undefined) checkListingUrl(issues, 'homepage', manifest.homepage);

  const openai = ((manifest.extensions ?? {}) as Record<string, Json | undefined>)['com.openai'];
  const ui = (openai?.interface ?? {}) as Json;
  checkInterfaceText(issues, ui, flavor);
  checkInterfaceLists(issues, ui);
  checkBrandColor(issues, 'brandColor', ui.brandColor, '#FFFFFF', 'white');
  if (ui.brandColorDark !== undefined) {
    checkBrandColor(issues, 'brandColorDark', ui.brandColorDark, '#212121', '#212121');
  }
  checkImage(issues, files, 'interface.logo', ui.logo, 'icon');
  checkImage(issues, files, 'interface.composerIcon', ui.composerIcon, 'icon');
  // Dark-theme variants are optional; a listed one meets the same rules.
  for (const field of ['logoDark', 'composerIconDark']) {
    if (ui[field] !== undefined) checkImage(issues, files, `interface.${field}`, ui[field], 'icon');
  }
  for (const shot of Array.isArray(ui.screenshots) ? ui.screenshots : []) {
    checkImage(issues, files, 'interface.screenshots', shot, 'screenshot');
  }
  for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    // The directory requires all four for an MCP review; a private package
    // may leave out what its operator does not publish.
    if (flavor === 'public' || ui[field] !== undefined) {
      checkListingUrl(issues, `interface.${field}`, ui[field]);
    }
  }

  const onboarding = openai?.onboardingSkill;
  if (onboarding === undefined) return;
  if (typeof onboarding !== 'string' || !files.has(onboarding.replace(/^\.\//, ''))) {
    issues.push({ file: 'plugin.json', message: 'onboardingSkill is not an included skill' });
  }
}

function checkInterfaceText(issues: ValidationIssue[], ui: Json, flavor: PluginFlavor): void {
  checkText(issues, 'interface.displayName', ui.displayName, 30);
  // The directory guidelines forbid these suffixes on a company or product name.
  if (
    flavor === 'public' &&
    typeof ui.displayName === 'string' &&
    /\s(?:mcp(?:\s+server)?|plugin)\s*$/i.test(ui.displayName)
  ) {
    issues.push({
      file: 'plugin.json',
      message: 'interface.displayName must not end with "MCP", "MCP Server" or "Plugin"',
    });
  }
  checkText(issues, 'interface.shortDescription', ui.shortDescription, 30);
  checkText(issues, 'interface.longDescription', ui.longDescription, 4000);
  checkText(issues, 'interface.developerName', ui.developerName, 80);
  checkText(issues, 'interface.category', ui.category, 80);
}

function isStringList(value: unknown, max: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === 'string' && item.length <= maxLength)
  );
}

function checkInterfaceLists(issues: ValidationIssue[], ui: Json): void {
  if (!isStringList(ui.capabilities, 20, 120)) {
    issues.push({ file: 'plugin.json', message: 'interface.capabilities: up to 20 strings' });
  }
  const prompts = ui.defaultPrompt;
  if (prompts === undefined) return;
  if (!isStringList(prompts, 3, 128) || new Set(prompts).size !== prompts.length) {
    issues.push({
      file: 'plugin.json',
      message: 'interface.defaultPrompt: up to 3 unique prompts of 128 characters',
    });
  }
}

/** A brand color must read on the theme background it is shown against. */
function checkBrandColor(
  issues: ValidationIssue[],
  field: string,
  color: unknown,
  background: string,
  backgroundName: string,
): void {
  if (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    issues.push({ file: 'plugin.json', message: `interface.${field} must be #RRGGBB` });
  } else if (contrastRatio(color, background) < 2) {
    issues.push({
      file: 'plugin.json',
      message: `interface.${field} needs 2:1 contrast against ${backgroundName}`,
    });
  }
}
