/**
 * `gitlab-mcp plugin build`: packages the plugin for a given MCP endpoint.
 */

import { resolve } from 'node:path';
import { buildPlugin, PluginBuildOptions } from './build';
import { LISTING } from './listing';
import { PluginValidationError } from './validate';

export const PLUGIN_USAGE = `Usage: gitlab-mcp plugin build --endpoint <url> [options]

Builds the GitLab MCP plugin package for an MCP endpoint you operate.

Options:
  --endpoint <url>      MCP endpoint, e.g. https://mcp.example.com/mcp (required)
  --out <dir>           Output directory (default: ./gitlab-mcp-plugin)
  --public              Apply directory submission rules: a public HTTPS host and
                        the privacy and terms links are required
  --privacy-url <url>   Privacy policy of the endpoint operator
  --terms-url <url>     Terms of service of the endpoint operator
`;

/** Parses `plugin build` arguments; throws with a usage hint on bad input. */
export function parsePluginArgs(args: string[]): PluginBuildOptions {
  if (args[0] !== 'build') throw new Error(PLUGIN_USAGE);
  const options: Partial<PluginBuildOptions> & { flavor: PluginBuildOptions['flavor'] } = {
    flavor: 'private',
    outDir: resolve('gitlab-mcp-plugin'),
  };
  const valueOf = (i: number, flag: string): string => {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--endpoint':
        options.endpoint = valueOf(i++, arg);
        break;
      case '--out':
        options.outDir = resolve(valueOf(i++, arg));
        break;
      case '--privacy-url':
        options.privacyPolicyUrl = valueOf(i++, arg);
        break;
      case '--terms-url':
        options.termsOfServiceUrl = valueOf(i++, arg);
        break;
      case '--public':
        options.flavor = 'public';
        break;
      default:
        throw new Error(`Unknown option ${arg}\n\n${PLUGIN_USAGE}`);
    }
  }
  if (!options.endpoint) throw new Error(`--endpoint is required\n\n${PLUGIN_USAGE}`);
  return options as PluginBuildOptions;
}

/** Runs the command and returns the process exit code. */
export function runPluginCommand(
  args: string[],
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): number {
  let options: PluginBuildOptions;
  try {
    options = parsePluginArgs(args);
  } catch (error) {
    err((error as Error).message);
    return 2;
  }
  try {
    const result = buildPlugin(options);
    out(`Built gitlab-mcp plugin ${result.version} for ${options.endpoint}`);
    out(`  Plugin folder: ${result.pluginDir}`);
    out(`  Marketplace:   ${result.marketplacePath}`);
    out(`  ZIP:           ${result.zipPath}`);
    out(`  SHA-256:       ${result.sha256}`);
    out('');
    out(
      options.flavor === 'public'
        ? 'Upload the ZIP in the OpenAI platform dashboard to submit it to the Plugins Directory.'
        : `Add the marketplace with: codex plugin marketplace add "${options.outDir}"\n` +
            `then install ${LISTING.displayName} from the Plugins Directory.`,
    );
    return 0;
  } catch (error) {
    err(
      error instanceof PluginValidationError ? error.message : `Error: ${(error as Error).message}`,
    );
    return 1;
  }
}
