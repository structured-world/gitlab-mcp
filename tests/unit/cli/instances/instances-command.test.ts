/**
 * Unit tests for instances-command CLI
 */

import {
  parseInstanceSubcommand,
  runInstanceCommand,
} from "../../../../src/cli/instances/instances-command";
import * as instancesLoader from "../../../../src/config/instances-loader";
import { InstanceRegistry } from "../../../../src/services/InstanceRegistry";

// Mock dependencies
jest.mock("../../../../src/config/instances-loader");
jest.mock("../../../../src/services/InstanceRegistry");
jest.mock("@clack/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  text: jest.fn(),
  password: jest.fn(),
  confirm: jest.fn(),
  cancel: jest.fn(),
  isCancel: jest.fn().mockReturnValue(false),
}));

const mockLoadInstancesConfig = instancesLoader.loadInstancesConfig as jest.MockedFunction<
  typeof instancesLoader.loadInstancesConfig
>;
const mockGenerateSampleConfig = instancesLoader.generateSampleConfig as jest.MockedFunction<
  typeof instancesLoader.generateSampleConfig
>;

describe("instances-command", () => {
  let consoleSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe("parseInstanceSubcommand", () => {
    it("should parse valid subcommands", () => {
      expect(parseInstanceSubcommand(["list"])).toEqual({
        subcommand: "list",
        subArgs: [],
      });

      expect(parseInstanceSubcommand(["add"])).toEqual({
        subcommand: "add",
        subArgs: [],
      });

      expect(parseInstanceSubcommand(["remove", "https://gitlab.com"])).toEqual({
        subcommand: "remove",
        subArgs: ["https://gitlab.com"],
      });

      expect(parseInstanceSubcommand(["test", "https://gitlab.com"])).toEqual({
        subcommand: "test",
        subArgs: ["https://gitlab.com"],
      });

      expect(parseInstanceSubcommand(["info", "https://gitlab.com"])).toEqual({
        subcommand: "info",
        subArgs: ["https://gitlab.com"],
      });

      expect(parseInstanceSubcommand(["sample-config", "yaml"])).toEqual({
        subcommand: "sample-config",
        subArgs: ["yaml"],
      });
    });

    it("should return undefined for invalid subcommand", () => {
      expect(parseInstanceSubcommand(["invalid"])).toEqual({
        subcommand: undefined,
        subArgs: ["invalid"],
      });
    });

    it("should return undefined for empty args", () => {
      expect(parseInstanceSubcommand([])).toEqual({
        subcommand: undefined,
        subArgs: [],
      });
    });
  });

  describe("runInstanceCommand", () => {
    describe("list subcommand", () => {
      it("should list configured instances", async () => {
        mockLoadInstancesConfig.mockResolvedValue({
          instances: [
            { url: "https://gitlab.com", label: "GitLab.com", insecureSkipVerify: false },
            {
              url: "https://git.corp.io",
              label: "Corporate",
              oauth: { clientId: "app_123", scopes: "api" },
              rateLimit: { maxConcurrent: 50, queueSize: 100, queueTimeout: 30000 },
              insecureSkipVerify: true,
            },
          ],
          source: "file",
          sourceDetails: "/etc/gitlab-mcp/instances.json",
        });

        await runInstanceCommand(["list"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("source: file"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("https://gitlab.com"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("GitLab.com"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[OAuth]"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[Rate: 50 concurrent]"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[TLS: skip]"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Total: 2 instance(s)"));
      });

      it("should handle empty instances list", async () => {
        mockLoadInstancesConfig.mockResolvedValue({
          instances: [],
          source: "none",
          sourceDetails: "default",
        });

        await runInstanceCommand(["list"]);

        expect(consoleSpy).toHaveBeenCalledWith("No instances configured.");
      });
    });

    describe("sample-config subcommand", () => {
      it("should show YAML sample config by default", async () => {
        mockGenerateSampleConfig.mockReturnValue("instances:\n  - url: https://gitlab.com");

        await runInstanceCommand(["sample-config"]);

        expect(mockGenerateSampleConfig).toHaveBeenCalledWith("yaml");
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Sample YAML"));
      });

      it("should show JSON sample config when specified", async () => {
        mockGenerateSampleConfig.mockReturnValue('{"instances": []}');

        await runInstanceCommand(["sample-config", "json"]);

        expect(mockGenerateSampleConfig).toHaveBeenCalledWith("json");
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Sample JSON"));
      });

      it("should mask clientSecret in JSON sample config", async () => {
        // Mock a JSON config with OAuth clientSecret
        mockGenerateSampleConfig.mockReturnValue(
          JSON.stringify({
            instances: [
              {
                url: "https://gitlab.example.com",
                oauth: {
                  clientId: "app_123",
                  clientSecret: "super_secret_value",
                },
              },
            ],
          })
        );

        await runInstanceCommand(["sample-config", "json"]);

        // Verify masked output was logged
        const loggedConfig = consoleSpy.mock.calls.find(
          (call: unknown[]) => typeof call[0] === "string" && call[0].includes("***masked***")
        );
        expect(loggedConfig).toBeDefined();

        // Verify original secret is not in output
        const hasUnmaskedSecret = consoleSpy.mock.calls.some(
          (call: unknown[]) => typeof call[0] === "string" && call[0].includes("super_secret_value")
        );
        expect(hasUnmaskedSecret).toBe(false);
      });

      it("should handle invalid JSON gracefully in sample config", async () => {
        // Mock invalid JSON
        mockGenerateSampleConfig.mockReturnValue("not valid json {");

        await runInstanceCommand(["sample-config", "json"]);

        // Should still output the original string (fallback behavior)
        expect(consoleSpy).toHaveBeenCalledWith("not valid json {");
      });
    });

    describe("remove subcommand", () => {
      it("should show usage when no URL provided", async () => {
        await runInstanceCommand(["remove"]);

        expect(consoleSpy).toHaveBeenCalledWith("Usage: instances remove <url>");
      });

      it("should show instructions when URL provided", async () => {
        await runInstanceCommand(["remove", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("To remove instance https://gitlab.com")
        );
      });
    });

    describe("test subcommand", () => {
      let mockRegistry: jest.Mocked<InstanceRegistry>;

      beforeEach(() => {
        mockRegistry = {
          isInitialized: jest.fn().mockReturnValue(true),
          initialize: jest.fn(),
          getUrls: jest.fn().mockReturnValue(["https://gitlab.com"]),
        } as unknown as jest.Mocked<InstanceRegistry>;

        (InstanceRegistry.getInstance as jest.Mock).mockReturnValue(mockRegistry);
      });

      it("should test specific URL when provided", async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ version: "16.5.0", revision: "abc123" }),
        });

        await runInstanceCommand(["test", "https://custom.gitlab.com"]);

        expect(global.fetch).toHaveBeenCalledWith(
          "https://custom.gitlab.com/api/v4/version",
          expect.any(Object)
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Connected"));
      });

      it("should test all instances when no URL provided", async () => {
        mockRegistry.getUrls.mockReturnValue(["https://gitlab.com", "https://git.corp.io"]);

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ version: "16.5.0" }),
        });

        await runInstanceCommand(["test"]);

        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      it("should handle 401 response as reachable", async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 401,
        });

        await runInstanceCommand(["test", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Reachable"));
      });

      it("should handle HTTP errors", async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 500,
        });

        await runInstanceCommand(["test", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Error: HTTP 500"));
      });

      it("should handle network errors", async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error("Connection refused"));

        await runInstanceCommand(["test", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("Failed: Connection refused")
        );
      });

      it("should handle empty instances list", async () => {
        mockRegistry.getUrls.mockReturnValue([]);

        await runInstanceCommand(["test"]);

        expect(consoleSpy).toHaveBeenCalledWith("No instances to test.");
      });

      it("should initialize registry if not initialized", async () => {
        mockRegistry.isInitialized.mockReturnValue(false);
        mockRegistry.getUrls.mockReturnValue([]);

        await runInstanceCommand(["test"]);

        expect(mockRegistry.initialize).toHaveBeenCalled();
      });
    });

    describe("info subcommand", () => {
      let mockRegistry: jest.Mocked<InstanceRegistry>;

      beforeEach(() => {
        mockRegistry = {
          isInitialized: jest.fn().mockReturnValue(true),
          initialize: jest.fn(),
          get: jest.fn(),
          getRateLimitMetrics: jest.fn(),
          getIntrospection: jest.fn(),
        } as unknown as jest.Mocked<InstanceRegistry>;

        (InstanceRegistry.getInstance as jest.Mock).mockReturnValue(mockRegistry);
      });

      it("should show usage when no URL provided", async () => {
        await runInstanceCommand(["info"]);

        expect(consoleSpy).toHaveBeenCalledWith("Usage: instances info <url>");
      });

      it("should show instance not found message", async () => {
        mockRegistry.get.mockReturnValue(undefined);

        await runInstanceCommand(["info", "https://unknown.gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Instance not found"));
      });

      it("should show full instance information", async () => {
        mockRegistry.get.mockReturnValue({
          config: {
            url: "https://gitlab.com",
            label: "GitLab.com",
            oauth: { clientId: "app_123", scopes: "api" },
            rateLimit: { maxConcurrent: 100, queueSize: 500, queueTimeout: 60000 },
            insecureSkipVerify: false,
          },
          state: {
            url: "https://gitlab.com",
            connectionStatus: "healthy",
            lastHealthCheck: new Date("2024-01-01T00:00:00Z"),
            introspectionCache: null,
            insecureSkipVerify: false,
          },
          rateLimiter: {} as any,
        });

        mockRegistry.getRateLimitMetrics.mockReturnValue({
          activeRequests: 5,
          maxConcurrent: 100,
          queuedRequests: 0,
          queueSize: 500,
          requestsTotal: 1000,
          requestsQueued: 50,
          requestsRejected: 2,
          avgQueueWaitMs: 15,
        });

        mockRegistry.getIntrospection.mockReturnValue({
          version: "16.5.0",
          tier: "ultimate",
          features: {},
          schemaInfo: {},
          cachedAt: new Date("2024-01-01T00:00:00Z"),
        });

        await runInstanceCommand(["info", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("URL: https://gitlab.com"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Label: GitLab.com"));
        // OAuth shows "client configured" without exposing clientId
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("OAuth: Enabled (client configured)")
        );
        // Verify clientId is NOT logged
        const hasClientId = consoleSpy.mock.calls.some(
          (call: unknown[]) => typeof call[0] === "string" && call[0].includes("app_123")
        );
        expect(hasClientId).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Max Concurrent: 100"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Connection: healthy"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Active Requests: 5/100"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Version: 16.5.0"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Tier: ultimate"));
      });

      it("should show instance without optional fields", async () => {
        mockRegistry.get.mockReturnValue({
          config: {
            url: "https://gitlab.com",
            insecureSkipVerify: false,
          },
          state: {
            url: "https://gitlab.com",
            connectionStatus: "healthy",
            lastHealthCheck: null,
            introspectionCache: null,
            insecureSkipVerify: false,
          },
          rateLimiter: {} as any,
        });

        mockRegistry.getRateLimitMetrics.mockReturnValue(undefined);
        mockRegistry.getIntrospection.mockReturnValue(null);

        await runInstanceCommand(["info", "https://gitlab.com"]);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Label: (none)"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("OAuth: Disabled"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("(never)"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("(not cached)"));
      });
    });

    describe("add subcommand", () => {
      const prompts = require("@clack/prompts");

      beforeEach(() => {
        prompts.isCancel.mockReturnValue(false);
      });

      it("should add instance without OAuth", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com") // url
          .mockResolvedValueOnce("My GitLab"); // label
        prompts.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true); // useOAuth=false, confirmed=true

        await runInstanceCommand(["add"]);

        expect(prompts.intro).toHaveBeenCalledWith("Add GitLab Instance");
        expect(prompts.outro).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Instance Configuration"));
      });

      it("should add instance with OAuth", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com") // url
          .mockResolvedValueOnce("My GitLab") // label
          .mockResolvedValueOnce("app_123"); // clientId
        prompts.password.mockResolvedValueOnce("secret456"); // clientSecret
        prompts.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true); // useOAuth=true, confirmed=true

        await runInstanceCommand(["add"]);

        expect(prompts.outro).toHaveBeenCalled();
      });

      it("should cancel on URL cancel", async () => {
        prompts.text.mockResolvedValueOnce(Symbol("cancel"));
        prompts.isCancel.mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel on label cancel", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce(Symbol("cancel"));
        prompts.isCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel on OAuth confirm cancel", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce("label");
        prompts.confirm.mockResolvedValueOnce(Symbol("cancel"));
        prompts.isCancel
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel on clientId cancel", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce("label")
          .mockResolvedValueOnce(Symbol("cancel")); // clientId cancelled
        prompts.confirm.mockResolvedValueOnce(true); // useOAuth=true
        prompts.isCancel
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel on clientSecret cancel", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce("label")
          .mockResolvedValueOnce("app_123");
        prompts.confirm.mockResolvedValueOnce(true);
        prompts.password.mockResolvedValueOnce(Symbol("cancel"));
        prompts.isCancel
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel on final confirm cancel", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce("label");
        prompts.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(Symbol("cancel"));
        prompts.isCancel
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true);

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });

      it("should cancel when user declines confirmation", async () => {
        prompts.text
          .mockResolvedValueOnce("https://gitlab.example.com")
          .mockResolvedValueOnce("label");
        prompts.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false); // declined

        await runInstanceCommand(["add"]);

        expect(prompts.cancel).toHaveBeenCalledWith("Cancelled");
      });
    });

    describe("help (no subcommand)", () => {
      it("should show help when no subcommand provided", async () => {
        await runInstanceCommand([]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("GitLab Instance Management")
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("list"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("add"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("remove"));
      });

      it("should show help for invalid subcommand", async () => {
        await runInstanceCommand(["invalid-command"]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("GitLab Instance Management")
        );
      });
    });
  });
});
