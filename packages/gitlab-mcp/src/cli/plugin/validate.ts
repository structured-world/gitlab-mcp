/**
 * Checks a plugin package against the Agent Plugins 1.0.0 schemas and the
 * OpenAI directory submission rules that can be verified offline.
 */

import { isIP } from 'net';
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

// A local absolute path in a published file ties it to one machine.
const LOCAL_PATH_PATTERN = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"'`]+/;

export interface ValidationIssue {
  file: string;
  message: string;
}

export class PluginValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Plugin package is invalid:\n${issues.map((i) => `  ${i.file}: ${i.message}`).join('\n')}`,
    );
    this.name = 'PluginValidationError';
  }
}

/** True for loopback, private, link-local and unique-local addresses and local names. */
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) {
    return true;
  }
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    );
  }
  // A single-label name only resolves inside a local network.
  return !host.includes('.');
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
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
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
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
  const json = (path: string): Record<string, unknown> | undefined => {
    const data = files.get(path);
    if (!data) {
      issues.push({ file: path, message: 'missing' });
      return undefined;
    }
    try {
      return JSON.parse(data.toString('utf8')) as Record<string, unknown>;
    } catch {
      issues.push({ file: path, message: 'not valid JSON' });
      return undefined;
    }
  };

  const manifest = json('plugin.json');
  const mcp = json('mcp.json');
  for (const [path, schema, value] of [
    ['plugin.json', schemas.plugin, manifest],
    ['mcp.json', schemas.mcp, mcp],
  ] as const) {
    if (value === undefined) continue;
    // Ajv registers a compiled schema under its $id and refuses to add it twice.
    const id = (schema as { $id?: string }).$id;
    const check = (id ? ajv.getSchema(id) : undefined) ?? ajv.compile(schema);
    if (!check(value)) {
      for (const error of check.errors ?? []) {
        issues.push({ file: path, message: `${error.instancePath || '/'} ${error.message ?? ''}` });
      }
    }
  }

  for (const path of files.keys()) {
    if (FORBIDDEN_PATHS.some((pattern) => pattern.test(path))) {
      issues.push({ file: path, message: 'not allowed in a directory submission' });
    }
    if (!/\.(json|md|txt|yaml|yml)$/.test(path)) continue;
    const text = files.get(path)?.toString('utf8') ?? '';
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) issues.push({ file: path, message: `contains a ${label}` });
    }
    if (LOCAL_PATH_PATTERN.test(text)) {
      issues.push({ file: path, message: 'contains a local absolute path' });
    }
    if (flavor === 'public') {
      for (const found of text.matchAll(/https?:\/\/[^\s"'`<>)\]]+/g)) {
        try {
          if (isNonPublicHost(new URL(found[0]).hostname)) {
            issues.push({ file: path, message: `references a non-public URL: ${found[0]}` });
          }
        } catch {
          // Not a URL after all; nothing to check.
        }
      }
    }
  }

  const skills = [...files.keys()].filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path));
  if (skills.length === 0) issues.push({ file: 'skills/', message: 'package has no skills' });
  for (const path of skills) checkSkill(issues, path, files.get(path) ?? Buffer.alloc(0));

  if (mcp) {
    const servers = Object.entries(
      (mcp.mcpServers ?? {}) as Record<string, Record<string, unknown>>,
    );
    // The directory connects exactly one MCP server per plugin.
    if (servers.length !== 1) {
      issues.push({ file: 'mcp.json', message: 'must declare exactly one MCP server' });
    }
    for (const [name, server] of servers) {
      if (server.headers && Object.keys(server.headers).length > 0) {
        issues.push({ file: 'mcp.json', message: `${name} must not declare headers` });
      }
      if (typeof server.url === 'string') {
        try {
          validateEndpoint(server.url, flavor);
        } catch (error) {
          issues.push({ file: 'mcp.json', message: `${name}: ${(error as Error).message}` });
        }
      }
    }
  }

  if (manifest) {
    checkText(issues, 'version', manifest.version, 64);
    if (typeof manifest.version === 'string' && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      issues.push({ file: 'plugin.json', message: 'version must be an explicit x.y.z version' });
    }
    checkText(issues, 'description', manifest.description, 4000);
    const author = (manifest.author ?? {}) as Record<string, unknown>;
    checkText(issues, 'author.name', author.name, 120);
    if (author.url !== undefined) checkListingUrl(issues, 'author.url', author.url);
    if (manifest.homepage !== undefined) checkListingUrl(issues, 'homepage', manifest.homepage);

    const openai = ((manifest.extensions ?? {}) as Record<string, Record<string, unknown>>)[
      'com.openai'
    ];
    const ui = (openai?.interface ?? {}) as Record<string, unknown>;
    checkText(issues, 'interface.displayName', ui.displayName, 30);
    checkText(issues, 'interface.shortDescription', ui.shortDescription, 30);
    checkText(issues, 'interface.longDescription', ui.longDescription, 4000);
    checkText(issues, 'interface.developerName', ui.developerName, 80);
    checkText(issues, 'interface.category', ui.category, 80);
    const capabilities = ui.capabilities;
    if (
      !Array.isArray(capabilities) ||
      capabilities.length > 20 ||
      capabilities.some((c) => typeof c !== 'string' || c.length > 120)
    ) {
      issues.push({ file: 'plugin.json', message: 'interface.capabilities: up to 20 strings' });
    }
    const prompts = ui.defaultPrompt;
    if (
      prompts !== undefined &&
      (!Array.isArray(prompts) ||
        prompts.length > 3 ||
        new Set(prompts).size !== prompts.length ||
        prompts.some((p) => typeof p !== 'string' || p.length > 128))
    ) {
      issues.push({
        file: 'plugin.json',
        message: 'interface.defaultPrompt: up to 3 unique prompts of 128 characters',
      });
    }
    if (typeof ui.brandColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(ui.brandColor)) {
      issues.push({ file: 'plugin.json', message: 'interface.brandColor must be #RRGGBB' });
    } else if (contrastRatio(ui.brandColor, '#FFFFFF') < 2) {
      issues.push({
        file: 'plugin.json',
        message: 'interface.brandColor needs 2:1 contrast against white',
      });
    }
    checkImage(issues, files, 'interface.logo', ui.logo, 'icon');
    checkImage(issues, files, 'interface.composerIcon', ui.composerIcon, 'icon');
    for (const shot of Array.isArray(ui.screenshots) ? ui.screenshots : []) {
      checkImage(issues, files, 'interface.screenshots', shot, 'screenshot');
    }

    const urlFields = ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'];
    for (const field of urlFields) {
      // The directory requires all four for an MCP review; a private package
      // may leave out what its operator does not publish.
      if (flavor === 'public' || ui[field] !== undefined) {
        checkListingUrl(issues, `interface.${field}`, ui[field]);
      }
    }

    const onboarding = openai?.onboardingSkill;
    if (
      onboarding !== undefined &&
      (typeof onboarding !== 'string' || !files.has(onboarding.replace(/^\.\//, '')))
    ) {
      issues.push({ file: 'plugin.json', message: 'onboardingSkill is not an included skill' });
    }
  }

  if (issues.length > 0) throw new PluginValidationError(issues);
}
