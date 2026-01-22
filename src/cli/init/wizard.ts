/**
 * Interactive init wizard using @clack/prompts
 */

import * as p from "@clack/prompts";
import {
  WizardConfig,
  UserRole,
  McpClient,
  ROLE_DESCRIPTIONS,
  MCP_CLIENT_INFO,
  ROLE_PRESETS,
} from "./types";
import { testConnection, validateGitLabUrl, getPatCreationUrl } from "./connection";
import {
  generateClientConfig,
  generateClaudeDeepLink,
  generateServerConfig,
} from "./config-generator";
import { openUrl } from "./browser";

/**
 * Mask sensitive values in content for display (JSON and CLI commands)
 */
function maskSensitiveContent(content: string): string {
  let masked = content;
  // Mask GITLAB_TOKEN value in JSON: "GITLAB_TOKEN": "value"
  // Pattern handles escaped quotes: (?:\\.|[^"\\])* matches escaped chars or non-quote/backslash
  masked = masked.replace(
    /("GITLAB_TOKEN"\s*:\s*")((?:\\.|[^"\\])*)(")/g,
    (_match, prefix, _token, suffix) => `${prefix}****${suffix}`
  );
  // Mask GITLAB_TOKEN in CLI commands: --env GITLAB_TOKEN="value" or GITLAB_TOKEN=value
  masked = masked.replace(
    /(GITLAB_TOKEN=")((?:\\.|[^"\\])*)(")/g,
    (_match, prefix, _token, suffix) => `${prefix}****${suffix}`
  );
  masked = masked.replace(/(GITLAB_TOKEN=)([^\s"]+)/g, (_match, prefix, _token) => `${prefix}****`);
  return masked;
}

/**
 * Run the interactive init wizard
 */
export async function runWizard(): Promise<void> {
  p.intro("GitLab MCP Setup Wizard");

  // Step 1: Select GitLab instance type
  const instanceType = await p.select({
    message: "Which GitLab instance do you want to connect to?",
    options: [
      { value: "saas" as const, label: "GitLab.com (SaaS)" },
      { value: "self-hosted" as const, label: "Self-hosted GitLab" },
    ],
  });

  if (p.isCancel(instanceType)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 2: Get instance URL
  let instanceUrl: string;
  if (instanceType === "saas") {
    instanceUrl = "https://gitlab.com";
  } else {
    const urlInput = await p.text({
      message: "Enter your GitLab instance URL:",
      placeholder: "https://gitlab.example.com",
      validate: value => {
        const result = validateGitLabUrl(value);
        return result.valid ? undefined : result.error;
      },
    });

    if (p.isCancel(urlInput)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    instanceUrl = urlInput;
  }

  // Step 3: Check if user has a token
  const hasToken = await p.confirm({
    message: "Do you already have a GitLab Personal Access Token (PAT)?",
    initialValue: false,
  });

  if (p.isCancel(hasToken)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  let token: string;

  if (!hasToken) {
    // Offer to open browser for PAT creation
    const patUrl = getPatCreationUrl(instanceUrl);

    p.note(
      `You need a Personal Access Token with these scopes:\n` +
        `  - api (full API access)\n` +
        `  - read_user (read user info)\n\n` +
        `Token URL: ${patUrl}`,
      "Create a Personal Access Token"
    );

    const openBrowser = await p.confirm({
      message: "Open browser to create token?",
      initialValue: true,
    });

    if (p.isCancel(openBrowser)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    if (openBrowser) {
      const opened = await openUrl(patUrl);
      if (opened) {
        p.log.info("Browser opened. Create your token and copy it.");
      } else {
        p.log.warn("Could not open browser automatically");
        p.note(patUrl, "Open this URL manually:");
      }
    }
  }

  // Step 4: Enter token
  const tokenInput = await p.password({
    message: "Enter your Personal Access Token:",
    validate: value => {
      if (!value || value.length < 10) {
        return "Token is too short";
      }
      return undefined;
    },
  });

  if (p.isCancel(tokenInput)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  token = tokenInput;

  // Step 5: Test connection
  const spinner = p.spinner();
  spinner.start("Testing connection...");

  const connectionResult = await testConnection(instanceUrl, token);

  if (!connectionResult.success) {
    spinner.stop("Connection failed");
    p.log.error(`Connection error: ${connectionResult.error ?? "Unknown error"}`);
    p.cancel("Please check your URL and token");
    process.exit(1);
  }

  spinner.stop("Connection successful!");

  p.log.success(
    `Connected as ${connectionResult.username ?? "unknown user"}` +
      (connectionResult.gitlabVersion ? ` (GitLab ${connectionResult.gitlabVersion})` : "")
  );

  // Step 6: Select role
  const roleOptions = (Object.keys(ROLE_DESCRIPTIONS) as UserRole[]).map(r => ({
    value: r,
    label: formatRoleLabel(r),
    hint: ROLE_DESCRIPTIONS[r],
  }));

  const role = await p.select({
    message: "What is your primary role?",
    options: roleOptions,
  });

  if (p.isCancel(role)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Step 7: Confirm read-only if applicable
  let readOnly = role === "readonly";
  if (!readOnly) {
    const confirmReadWrite = await p.confirm({
      message: "Enable write operations (create issues, merge MRs, etc.)?",
      initialValue: true,
    });

    if (p.isCancel(confirmReadWrite)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    readOnly = !confirmReadWrite;
  }

  // Step 8: Select MCP client
  const clientOptions = (Object.keys(MCP_CLIENT_INFO) as McpClient[]).map(c => ({
    value: c,
    label: MCP_CLIENT_INFO[c].name,
    hint: MCP_CLIENT_INFO[c].configPath ?? undefined,
  }));

  const client = await p.select({
    message: "Which MCP client are you using?",
    options: clientOptions,
  });

  if (p.isCancel(client)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Build configuration
  const wizardConfig: WizardConfig = {
    instanceUrl,
    token,
    role,
    client,
    readOnly,
    presetName: ROLE_PRESETS[role],
  };

  // Generate configuration
  const generatedConfig = generateClientConfig(wizardConfig);

  // Display results
  p.log.step("Configuration generated");

  if (generatedConfig.type === "cli" && generatedConfig.cliCommand) {
    // Claude Code - offer CLI installation
    // Mask token in displayed command for security (actual command uses real token)
    p.note(maskSensitiveContent(generatedConfig.cliCommand), "Run this command to install:");

    const runNow = await p.confirm({
      message: "Run this command now?",
      initialValue: true,
    });

    if (!p.isCancel(runNow) && runNow) {
      // Execute claude mcp add command using spawnSync with argument array
      // to prevent command injection vulnerabilities
      const { spawnSync } = await import("child_process");
      const serverConfig = generateServerConfig(wizardConfig);
      const args = [
        "mcp",
        "add",
        "gitlab",
        serverConfig.command,
        ...serverConfig.args,
        ...Object.entries(serverConfig.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      ];

      try {
        spinner.start("Installing MCP server...");
        const result = spawnSync("claude", args, { stdio: "inherit" });
        if (result.status === 0) {
          spinner.stop("MCP server installed!");
        } else {
          spinner.stop("Installation failed");
          p.log.error("Failed to run command. You can run it manually.");
        }
      } catch {
        spinner.stop("Installation failed");
        p.log.error("Failed to run command. You can run it manually.");
      }
    }
  } else {
    // JSON configuration - mask PAT in terminal output for security
    p.note(maskSensitiveContent(generatedConfig.content), "Add to your MCP configuration:");
    p.log.warn("Note: Replace **** with your actual token in the config file");

    if (generatedConfig.configPath) {
      p.log.info(`Config file: ${generatedConfig.configPath}`);
    }
  }

  // Offer Claude Deep Link for Claude Desktop
  if (client === "claude-desktop") {
    const deepLink = generateClaudeDeepLink(wizardConfig);

    const useDeepLink = await p.confirm({
      message: "Open Claude Desktop to install automatically?",
      initialValue: true,
    });

    if (!p.isCancel(useDeepLink) && useDeepLink) {
      const opened = await openUrl(deepLink);
      if (opened) {
        p.log.success("Claude Desktop should open with the configuration");
      } else {
        p.log.warn("Could not open Claude Desktop automatically");
        p.log.warn(
          "Security: this link contains your GitLab token encoded. " +
            "Do NOT share or store it in logs/chat."
        );
        p.note(deepLink, "Copy this sensitive link (treat like a password):");
      }
    }
  }

  // Summary
  p.outro(
    `Setup complete! Preset: ${wizardConfig.presetName ?? "default"}` +
      (readOnly ? " (read-only)" : "")
  );
}

/**
 * Format role label for display
 */
function formatRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    developer: "Developer",
    "senior-developer": "Senior Developer",
    "tech-lead": "Tech Lead / Admin",
    devops: "DevOps Engineer",
    reviewer: "Code Reviewer",
    readonly: "Read-Only Access",
  };
  return labels[role];
}
