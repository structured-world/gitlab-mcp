/**
 * Builds the GitLab MCP plugin package: plugin.json, mcp.json, skills and
 * assets, plus a local marketplace and a ZIP for directory submission.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  LISTING,
  LISTING_ASSETS,
  LOGO_SOURCE,
  MCP_SERVER_NAME,
  ONBOARDING_SKILL,
  PLUGIN_KEYWORDS,
  PLUGIN_NAME,
} from './listing';
import { PluginFlavor, validateEndpoint, validatePackage } from './validate';
import { compareCodeUnits, createZip } from './zip';
import { collectRuntime } from './runtime';

const PACKAGE_NAME = '@structured-world/gitlab-mcp';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const LOGO_PATH = 'assets/logo.png';

/** Plugin-relative path of a listing image: assets/ plus its file name. */
function assetPath(source: string): string {
  return `assets/${basename(source)}`;
}

const LISTING_IMAGES = [
  LISTING_ASSETS.composerIcon,
  LISTING_ASSETS.composerIconDark,
  ...LISTING_ASSETS.screenshots,
];

export interface PluginBuildOptions {
  /** MCP endpoint the package connects to. */
  endpoint?: string;
  /** Resolve the published, version-pinned npm runtime instead of embedding dependencies. */
  npmRuntime?: boolean;
  /** Export an installable marketplace ZIP instead of a directory-submission ZIP. */
  marketplaceZip?: boolean;
  flavor: PluginFlavor;
  /** Directory receiving the marketplace, the plugin folder and the ZIP. */
  outDir: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  /** Package root holding package.json, skills and plugin assets. */
  packageRoot?: string;
}

export interface PluginBuildResult {
  version: string;
  pluginDir: string;
  marketplacePath: string;
  zipPath: string;
  sha256: string;
  checksumPath?: string;
  files: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  bugs?: { url?: string } | string;
  mcp?: { homepage?: string };
}

/** Finds the installed or checked-out package root from this module's location. */
export function findPackageRoot(start: string = __dirname): string {
  let dir = start;
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as PackageJson;
      if (pkg.name === PACKAGE_NAME) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot locate the ${PACKAGE_NAME} package root`);
    dir = parent;
  }
}

/** Splits an npm "Name <email> (url)" author string. */
export function parseAuthor(author: string): { name: string; email?: string } {
  const nameEnd = author.search(/[<(]/);
  const name = (nameEnd === -1 ? author : author.slice(0, nameEnd)).trim();
  const open = author.indexOf('<');
  const close = open === -1 ? -1 : author.indexOf('>', open + 1);
  const email = close === -1 ? '' : author.slice(open + 1, close).trim();
  return email ? { name, email } : { name };
}

function urlOf(field: PackageJson['repository']): string | undefined {
  return typeof field === 'string' ? field : field?.url;
}

/** Plugin-relative path to file content, read from the package. */
function collectFiles(root: string, manifest: object, mcp: object): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set('plugin.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  files.set('mcp.json', Buffer.from(`${JSON.stringify(mcp, null, 2)}\n`));
  files.set(LOGO_PATH, readFileSync(join(root, LOGO_SOURCE)));
  for (const source of LISTING_IMAGES) {
    files.set(assetPath(source), readFileSync(join(root, source)));
  }
  const skillsDir = join(root, 'skills');
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = join(skillsDir, entry.name, 'SKILL.md');
    if (existsSync(skill)) files.set(`skills/${entry.name}/SKILL.md`, readFileSync(skill));
  }
  return files;
}

interface Marketplace {
  name: string;
  interface?: unknown;
  plugins: Array<{ name?: unknown }>;
  [key: string]: unknown;
}

function readMarketplace(path: string): Marketplace | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const plugins = (parsed as { plugins?: unknown } | null)?.plugins;
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(plugins)) {
      throw new Error('expected an object with a plugins list');
    }
    return parsed as Marketplace;
  } catch (error) {
    throw new Error(`Cannot read the existing marketplace ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * Puts the GitLab entry into a marketplace: a new catalog of its own, or an
 * existing one with the other plugins, its name and its interface kept.
 */
function mergeMarketplace(existing: Marketplace | undefined): Marketplace {
  const entry = {
    name: PLUGIN_NAME,
    source: { source: 'local', path: `./plugins/${PLUGIN_NAME}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: LISTING.category,
  };
  if (!existing) {
    return { name: PLUGIN_NAME, interface: { displayName: LISTING.displayName }, plugins: [entry] };
  }
  const plugins = existing.plugins.filter((plugin) => plugin.name !== PLUGIN_NAME);
  return { ...existing, plugins: [...plugins, entry] };
}

/** OAuth discovery and registration come from the selected endpoint itself. */
function connectionManifest(
  options: PluginBuildOptions,
  endpoint: URL | undefined,
  version: string,
) {
  return {
    $schema: MCP_SCHEMA,
    mcpServers: {
      [MCP_SERVER_NAME]: endpoint
        ? { type: 'streamable-http', url: endpoint.href }
        : {
            type: 'stdio',
            command: options.npmRuntime ? 'npx' : 'node',
            args: options.npmRuntime
              ? [
                  '-y',
                  '--package',
                  `${PACKAGE_NAME}@${version}`,
                  'gitlab-mcp-plugin',
                  '${PLUGIN_DATA}',
                ]
              : ['${PLUGIN_ROOT}/runtime/src/plugin/main.js', '${PLUGIN_DATA}'],
            cwd: '${PLUGIN_ROOT}',
          },
    },
  };
}

function writeArchive(files: Map<string, Buffer>, options: PluginBuildOptions, version: string) {
  const entries = [...files].map(([path, data]) => ({
    path: options.marketplaceZip ? `plugins/${PLUGIN_NAME}/${path}` : path,
    data,
  }));
  if (options.marketplaceZip) {
    // A standalone export must not include unrelated entries from the caller's catalog.
    entries.push({
      path: '.agents/plugins/marketplace.json',
      data: Buffer.from(`${JSON.stringify(mergeMarketplace(undefined), null, 2)}\n`),
    });
  }
  const zip = createZip(entries);
  const zipPath = join(
    options.outDir,
    options.marketplaceZip ? `${PLUGIN_NAME}-codex.zip` : `${PLUGIN_NAME}-${version}.zip`,
  );
  writeFileSync(zipPath, zip);
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const checksumPath = options.marketplaceZip ? `${zipPath}.sha256` : undefined;
  if (checksumPath) writeFileSync(checksumPath, `${sha256}  ${basename(zipPath)}\n`);
  return { zipPath, sha256, ...(checksumPath ? { checksumPath } : {}) };
}

export function buildPlugin(options: PluginBuildOptions): PluginBuildResult {
  if (options.marketplaceZip && options.flavor === 'public')
    throw new Error('Marketplace archives cannot use directory submission rules.');
  const root = options.packageRoot ?? findPackageRoot();
  const endpoint =
    options.endpoint === undefined ? undefined : validateEndpoint(options.endpoint, options.flavor);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;
  if (!pkg.version) throw new Error('package.json has no version');
  if (endpoint && options.npmRuntime)
    throw new Error('--npm-runtime cannot be combined with --endpoint');
  // The documentation site; the npm homepage points at the repository README.
  const homepage = pkg.mcp?.homepage ?? pkg.homepage;
  const support = urlOf(pkg.bugs);

  const manifest = {
    $schema: PLUGIN_SCHEMA,
    name: PLUGIN_NAME,
    version: pkg.version,
    description: pkg.description,
    author: { ...parseAuthor(pkg.author ?? ''), ...(homepage ? { url: homepage } : {}) },
    homepage,
    repository: urlOf(pkg.repository),
    license: pkg.license,
    keywords: [...PLUGIN_KEYWORDS],
    extensions: {
      'com.openai': {
        onboardingSkill: `./skills/${ONBOARDING_SKILL}/SKILL.md`,
        interface: {
          ...LISTING,
          capabilities: [...LISTING.capabilities],
          defaultPrompt: [...LISTING.defaultPrompt],
          websiteURL: homepage,
          supportURL: support,
          ...(options.privacyPolicyUrl ? { privacyPolicyURL: options.privacyPolicyUrl } : {}),
          ...(options.termsOfServiceUrl ? { termsOfServiceURL: options.termsOfServiceUrl } : {}),
          composerIcon: `./${assetPath(LISTING_ASSETS.composerIcon)}`,
          composerIconDark: `./${assetPath(LISTING_ASSETS.composerIconDark)}`,
          logo: `./${LOGO_PATH}`,
          screenshots: LISTING_ASSETS.screenshots.map((source) => `./${assetPath(source)}`),
        },
      },
    },
  };
  const mcp = connectionManifest(options, endpoint, pkg.version);

  const files = collectFiles(root, manifest, mcp);
  if (!endpoint && !options.npmRuntime) collectRuntime(root, files);
  const schema = (name: string): object =>
    JSON.parse(readFileSync(join(root, 'plugin', 'schemas', name), 'utf8')) as object;
  validatePackage(
    files,
    { plugin: schema('plugin.schema.json'), mcp: schema('mcp.schema.json') },
    options.flavor,
  );

  // Read before anything is written, so an unreadable catalog leaves outDir untouched.
  const marketplacePath = join(options.outDir, '.agents', 'plugins', 'marketplace.json');
  const marketplace = mergeMarketplace(readMarketplace(marketplacePath));

  // Only the generated plugin folder is replaced; the rest of outDir is the caller's.
  const pluginDir = join(options.outDir, 'plugins', PLUGIN_NAME);
  rmSync(pluginDir, { recursive: true, force: true });
  for (const [path, data] of files) {
    const target = join(pluginDir, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  mkdirSync(dirname(marketplacePath), { recursive: true });
  writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

  return {
    version: pkg.version,
    pluginDir,
    marketplacePath,
    ...writeArchive(files, options, pkg.version),
    files: [...files.keys()].sort(compareCodeUnits),
  };
}
