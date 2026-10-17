/**
 * Checks a plugin package against the Agent Plugins 1.0.0 schemas and the
 * OpenAI directory submission rules that can be verified offline.
 */

import { isIP } from 'node:net';
import Ajv2020 from 'ajv/dist/2020';
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
// lookbehind skips the same words as segments of a web URL path.
const LOCAL_PATH_PATTERN = /(?<![\w.~-])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"'`]+/;

// The grammar published with Semantic Versioning 2.0.0 ("Is there a suggested
// regular expression"): prerelease and build metadata included.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// Matches a URL in text, including a bracketed IPv6 host (RFC 3986 3.2.2).
const URL_IN_TEXT_PATTERN = /https?:\/\/(?:\[[0-9A-Fa-f:.]+\])?[^\s"'`<>)\]]*/g;

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
  ['192.0.0.0', 24], // IETF protocol assignments, RFC 6890 2.2.2
  ['192.0.2.0', 24], // documentation TEST-NET-1, RFC 5737
  ['192.168.0.0', 16], // private, RFC 1918
  ['198.18.0.0', 15], // benchmarking, RFC 2544
  ['198.51.100.0', 24], // documentation TEST-NET-2, RFC 5737
  ['203.0.113.0', 24], // documentation TEST-NET-3, RFC 5737
  ['224.0.0.0', 4], // multicast, RFC 5771
  ['240.0.0.0', 4], // reserved and limited broadcast
];

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function isNonPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return NON_PUBLIC_IPV4.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    return Math.floor(value / size) === Math.floor(ipv4ToNumber(base) / size);
  });
}

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
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) return isNonPublicIpv4(host);
  if (family === 6) {
    // IPv4-mapped (RFC 4291 2.5.5.2), canonicalized by URL to ::ffff:hhhh:hhhh.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return isNonPublicHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host) ||
      // Multicast (RFC 4291 2.7) and documentation (RFC 3849).
      host.startsWith('ff') ||
      /^2001:0?db8:/.test(host) ||
      // Any other ::ffff: spelling is not one URL produces; treat it as local.
      host.startsWith('::ffff:')
    );
  }
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

function checkText(
  issues: ValidationIssue[],
  field: string,
  value: unknown,
  max: number,
  required = true,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (required) issues.push({ file: 'plugin.json', message: `${field} is required` });
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
  for (const error of check.errors ?? []) {
    issues.push({ file: path, message: `${error.instancePath || '/'} ${error.message ?? ''}` });
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
  const skills = [...files.keys()].filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path));
  if (skills.length === 0) issues.push({ file: 'skills/', message: 'package has no skills' });
  for (const path of skills) checkSkill(issues, path, files.get(path) ?? Buffer.alloc(0));
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
  if (typeof manifest.version === 'string' && !SEMVER_PATTERN.test(manifest.version)) {
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
  checkBrandColor(issues, ui.brandColor);
  checkImage(issues, files, 'interface.logo', ui.logo, 'icon');
  checkImage(issues, files, 'interface.composerIcon', ui.composerIcon, 'icon');
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

function checkBrandColor(issues: ValidationIssue[], color: unknown): void {
  if (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    issues.push({ file: 'plugin.json', message: 'interface.brandColor must be #RRGGBB' });
  } else if (contrastRatio(color, '#FFFFFF') < 2) {
    issues.push({
      file: 'plugin.json',
      message: 'interface.brandColor needs 2:1 contrast against white',
    });
  }
}
