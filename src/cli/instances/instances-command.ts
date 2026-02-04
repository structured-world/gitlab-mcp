/**
 * Instance management CLI commands
 *
 * Commands:
 * - list: List all configured instances
 * - add: Add a new instance interactively
 * - remove: Remove an instance
 * - test: Test connection to an instance
 * - info: Show detailed instance information
 */

import * as p from "@clack/prompts";
import { InstanceRegistry } from "../../services/InstanceRegistry.js";
import { loadInstancesConfig, generateSampleConfig } from "../../config/instances-loader.js";
import { GitLabInstanceConfig } from "../../config/instances-schema.js";

/**
 * Instance subcommand type
 */
export type InstanceSubcommand = "list" | "add" | "remove" | "test" | "info" | "sample-config";

/**
 * Parse instance subcommand from CLI args
 */
export function parseInstanceSubcommand(args: string[]): {
  subcommand: InstanceSubcommand | undefined;
  subArgs: string[];
} {
  const subcommand = args[0] as InstanceSubcommand | undefined;
  const subArgs = args.slice(1);

  const validSubcommands: InstanceSubcommand[] = [
    "list",
    "add",
    "remove",
    "test",
    "info",
    "sample-config",
  ];

  if (subcommand && !validSubcommands.includes(subcommand)) {
    return { subcommand: undefined, subArgs: args };
  }

  return { subcommand, subArgs };
}

/**
 * Run instance subcommand
 */
export async function runInstanceCommand(args: string[]): Promise<void> {
  const { subcommand, subArgs } = parseInstanceSubcommand(args);

  if (!subcommand) {
    showHelp();
    return;
  }

  switch (subcommand) {
    case "list":
      await listInstances();
      break;
    case "add":
      await addInstance();
      break;
    case "remove":
      await removeInstance(subArgs[0]);
      break;
    case "test":
      await testInstance(subArgs[0]);
      break;
    case "info":
      await showInstanceInfo(subArgs[0]);
      break;
    case "sample-config":
      showSampleConfig(subArgs[0] as "yaml" | "json" | undefined);
      break;
  }
}

/**
 * Show help for instance commands
 */
function showHelp(): void {
  console.log(`
GitLab Instance Management Commands

Usage: npx @structured-world/gitlab-mcp instances <command> [options]

Commands:
  list                List all configured GitLab instances
  add                 Add a new GitLab instance (interactive)
  remove <url>        Remove a GitLab instance
  test [url]          Test connection to instance(s)
  info <url>          Show detailed instance information
  sample-config [fmt] Generate sample config file (yaml or json)

Configuration:
  Instances can be configured via:
  1. GITLAB_INSTANCES_FILE - Path to YAML/JSON config file
  2. GITLAB_INSTANCES - Environment variable (URL, array, or JSON)
  3. GITLAB_API_URL - Legacy single-instance mode

Examples:
  npx @structured-world/gitlab-mcp instances list
  npx @structured-world/gitlab-mcp instances add
  npx @structured-world/gitlab-mcp instances test https://gitlab.com
  npx @structured-world/gitlab-mcp instances sample-config yaml
`);
}

/**
 * List all configured instances
 */
async function listInstances(): Promise<void> {
  const config = await loadInstancesConfig();

  console.log(`\nConfigured GitLab Instances (source: ${config.source})`);
  console.log(`─`.repeat(60));

  if (config.instances.length === 0) {
    console.log("No instances configured.");
    return;
  }

  for (const instance of config.instances) {
    const label = instance.label ? ` (${instance.label})` : "";
    const oauth = instance.oauth ? " [OAuth]" : "";
    const rateLimit = instance.rateLimit
      ? ` [Rate: ${instance.rateLimit.maxConcurrent} concurrent]`
      : "";
    const tls = instance.insecureSkipVerify ? " [TLS: skip]" : "";

    console.log(`  ${instance.url}${label}${oauth}${rateLimit}${tls}`);
  }

  console.log(`\nTotal: ${config.instances.length} instance(s)`);
}

/**
 * Add a new instance interactively
 */
async function addInstance(): Promise<void> {
  p.intro("Add GitLab Instance");

  const url = await p.text({
    message: "GitLab instance URL:",
    placeholder: "https://gitlab.com",
    validate: value => {
      if (!value) return "URL is required";
      try {
        new URL(value);
        return undefined;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });

  if (p.isCancel(url)) {
    p.cancel("Cancelled");
    return;
  }

  const label = await p.text({
    message: "Label (optional):",
    placeholder: "My GitLab",
  });

  if (p.isCancel(label)) {
    p.cancel("Cancelled");
    return;
  }

  const useOAuth = await p.confirm({
    message: "Configure OAuth?",
    initialValue: false,
  });

  if (p.isCancel(useOAuth)) {
    p.cancel("Cancelled");
    return;
  }

  let oauth: GitLabInstanceConfig["oauth"];
  if (useOAuth) {
    const clientId = await p.text({
      message: "OAuth Application ID:",
      validate: value => (value ? undefined : "Required"),
    });

    if (p.isCancel(clientId)) {
      p.cancel("Cancelled");
      return;
    }

    const clientSecret = await p.password({
      message: "OAuth Secret (optional, for confidential apps):",
    });

    if (p.isCancel(clientSecret)) {
      p.cancel("Cancelled");
      return;
    }

    oauth = {
      clientId: clientId,
      clientSecret: clientSecret || undefined,
      scopes: "api read_user",
    };
  }

  const config: GitLabInstanceConfig = {
    url: url,
    label: label || undefined,
    oauth,
    insecureSkipVerify: false,
  };

  // Create a safe-to-log preview object with ONLY non-sensitive fields.
  // This is a defense-in-depth pattern: even if config structure changes,
  // we explicitly allowlist which fields to log rather than excluding secrets.
  // NOTE: The original `config` object contains secrets but is never passed to
  // logging functions — only this sanitized preview is logged.
  const logConfigPreview: {
    url: string;
    label?: string;
    insecureSkipVerify: boolean;
    oauthConfigured: boolean;
  } = {
    url: config.url,
    label: config.label,
    insecureSkipVerify: config.insecureSkipVerify,
    oauthConfigured: !!config.oauth,
  };
  console.log("\nInstance Configuration:");
  // Safe: logConfigPreview contains no secrets (allowlist pattern above)
  console.log(JSON.stringify(logConfigPreview, null, 2));

  const confirmed = await p.confirm({
    message: "Add this configuration?",
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled");
    return;
  }

  // Note: In a real implementation, this would persist the config
  // Using config.url and oauth.clientId directly here is safe — these are
  // NOT secrets. Only clientSecret is sensitive (not shown in output).
  // We show the actual clientId (not a placeholder) because the user just
  // entered it and needs the exact value to copy into their config file.
  p.outro(`
Instance configured! To use it, add to your configuration:

Environment variable:
  GITLAB_INSTANCES="${config.url}${oauth ? `:${oauth.clientId}` : ""}"

Or add to instances.yaml:
  instances:
    - url: ${config.url}
      label: "${config.label ?? ""}"
${oauth ? `      oauth:\n        clientId: "${oauth.clientId}"` : ""}
`);
}

/**
 * Remove an instance
 */
async function removeInstance(url?: string): Promise<void> {
  if (!url) {
    console.log("Usage: instances remove <url>");
    console.log("Example: instances remove https://gitlab.com");
    return;
  }

  // Note: In a real implementation, this would modify the config file
  console.log(`\nTo remove instance ${url}, edit your configuration file`);
  console.log("and remove the corresponding entry from the instances array.");
}

/**
 * Test connection to an instance
 */
async function testInstance(url?: string): Promise<void> {
  const registry = InstanceRegistry.getInstance();

  if (!registry.isInitialized()) {
    await registry.initialize();
  }

  const urls = url ? [url] : registry.getUrls();

  if (urls.length === 0) {
    console.log("No instances to test.");
    return;
  }

  console.log("\nTesting GitLab Instance Connections");
  console.log(`─`.repeat(60));

  for (const instanceUrl of urls) {
    process.stdout.write(`  ${instanceUrl}... `);

    try {
      // Try to fetch version endpoint
      const versionUrl = `${instanceUrl}/api/v4/version`;
      const response = await fetch(versionUrl, {
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const data = (await response.json()) as { version?: string; revision?: string };
        console.log(`✓ Connected (v${data.version ?? "unknown"})`);
      } else if (response.status === 401) {
        console.log("✓ Reachable (authentication required)");
      } else {
        console.log(`✗ Error: HTTP ${response.status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`✗ Failed: ${message}`);
    }
  }
}

/**
 * Show detailed instance information
 */
async function showInstanceInfo(url?: string): Promise<void> {
  if (!url) {
    console.log("Usage: instances info <url>");
    console.log("Example: instances info https://gitlab.com");
    return;
  }

  const registry = InstanceRegistry.getInstance();

  if (!registry.isInitialized()) {
    await registry.initialize();
  }

  const entry = registry.get(url);
  if (!entry) {
    console.log(`Instance not found: ${url}`);
    console.log("Use 'instances list' to see configured instances.");
    return;
  }

  const { config, state } = entry;
  const metrics = registry.getRateLimitMetrics(url);
  const introspection = registry.getIntrospection(url);

  console.log(`\nInstance Information: ${url}`);
  console.log(`─`.repeat(60));

  console.log("\nConfiguration:");
  console.log(`  URL: ${config.url}`);
  console.log(`  Label: ${config.label ?? "(none)"}`);
  console.log(`  OAuth: ${config.oauth ? "Enabled (client configured)" : "Disabled"}`);
  console.log(`  TLS Verify: ${config.insecureSkipVerify ? "Disabled" : "Enabled"}`);

  if (config.rateLimit) {
    console.log("\nRate Limit Config:");
    console.log(`  Max Concurrent: ${config.rateLimit.maxConcurrent}`);
    console.log(`  Queue Size: ${config.rateLimit.queueSize}`);
    console.log(`  Queue Timeout: ${config.rateLimit.queueTimeout}ms`);
  }

  console.log("\nRuntime State:");
  console.log(`  Connection: ${state.connectionStatus}`);
  console.log(`  Last Health Check: ${state.lastHealthCheck?.toISOString() ?? "(never)"}`);

  if (metrics) {
    console.log("\nRate Limit Metrics:");
    console.log(`  Active Requests: ${metrics.activeRequests}/${metrics.maxConcurrent}`);
    console.log(`  Queued: ${metrics.queuedRequests}/${metrics.queueSize}`);
    console.log(`  Total Requests: ${metrics.requestsTotal}`);
    console.log(`  Rejected: ${metrics.requestsRejected}`);
    console.log(`  Avg Queue Wait: ${metrics.avgQueueWaitMs}ms`);
  }

  if (introspection) {
    console.log("\nIntrospection Cache:");
    console.log(`  Version: ${introspection.version}`);
    console.log(`  Tier: ${introspection.tier}`);
    console.log(`  Cached At: ${introspection.cachedAt.toISOString()}`);
  } else {
    console.log("\nIntrospection Cache: (not cached)");
  }
}

/**
 * Show sample configuration file.
 * Always masks clientSecret fields to prevent setting a dangerous precedent
 * of logging secrets, even though these are placeholder values.
 */
function showSampleConfig(format?: "yaml" | "json"): void {
  const fmt = format ?? "yaml";
  let config = generateSampleConfig(fmt);

  // Mask clientSecret in output to prevent dangerous patterns.
  // Even though these are placeholder values, we always mask secrets
  // to avoid copy-paste mistakes and set a consistent security pattern.
  if (fmt === "json") {
    try {
      // Work on a parsed copy - JSON.parse creates a new object
      const parsed = JSON.parse(config) as {
        instances?: Array<{ oauth?: { clientSecret?: string } }>;
        defaults?: { oauth?: { clientSecret?: string } };
      };

      if (parsed?.instances) {
        for (const instance of parsed.instances) {
          if (instance?.oauth?.clientSecret) {
            instance.oauth.clientSecret = "***masked***";
          }
        }
      }
      if (parsed?.defaults?.oauth?.clientSecret) {
        parsed.defaults.oauth.clientSecret = "***masked***";
      }

      config = JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, fall back to the original string
    }
  } else {
    // Mask secrets in YAML format using regex.
    // Pattern handles: clientSecret: value, clientSecret: "value", clientSecret: 'value'
    // Sample config has predictable structure — full YAML parser is overkill.
    // Pattern won't re-match already-masked values (***masked*** contains *).
    config = config.replace(/clientSecret:\s*["']?[^"'\n]+["']?/g, 'clientSecret: "***masked***"');
  }

  console.log(`\nSample ${fmt.toUpperCase()} Configuration:`);
  console.log(`─`.repeat(60));
  console.log(config);
}
