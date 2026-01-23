/**
 * Integrations Registry Unit Tests
 * Tests registry structure and handler behavior for integrations tools
 */

import {
  integrationsToolRegistry,
  getIntegrationsReadOnlyToolNames,
  getIntegrationsToolDefinitions,
  getFilteredIntegrationsTools,
} from "../../../../src/entities/integrations/registry";
import { enhancedFetch } from "../../../../src/utils/fetch";

// Mock enhancedFetch to avoid actual API calls
jest.mock("../../../../src/utils/fetch", () => ({
  enhancedFetch: jest.fn(),
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: "https://gitlab.example.com",
    GITLAB_TOKEN: "test-token-12345",
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  mockEnhancedFetch.mockReset();
});

describe("Integrations Registry", () => {
  describe("Registry Structure", () => {
    it("should be a Map instance", () => {
      expect(integrationsToolRegistry instanceof Map).toBe(true);
    });

    it("should contain expected integrations tools", () => {
      const toolNames = Array.from(integrationsToolRegistry.keys());

      // Check for read-only tools
      expect(toolNames).toContain("browse_integrations");

      // Check for manage tool
      expect(toolNames).toContain("manage_integration");
    });

    it("should have tools with valid structure", () => {
      const toolEntries = Array.from(integrationsToolRegistry.values());

      toolEntries.forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("handler");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
        expect(typeof tool.handler).toBe("function");
      });
    });

    it("should have unique tool names", () => {
      const toolNames = Array.from(integrationsToolRegistry.keys());
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it("should have exactly 2 integration tools", () => {
      expect(integrationsToolRegistry.size).toBe(2);
    });
  });

  describe("Tool Definitions", () => {
    it("should have proper browse_integrations tool", () => {
      const tool = integrationsToolRegistry.get("browse_integrations");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("browse_integrations");
      expect(tool!.description).toContain("BROWSE project integrations");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should have proper manage_integration tool", () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("manage_integration");
      expect(tool!.description).toContain("MANAGE project integrations");
      expect(tool!.inputSchema).toBeDefined();
    });

    it("should mention supported integrations in manage_integration description", () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("Slack");
      expect(tool!.description).toContain("Jira");
      expect(tool!.description).toContain("Discord");
    });

    it("should mention gitlab-slack-application limitation in description", () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("gitlab-slack-application cannot be created via API");
    });
  });

  describe("Read-Only Tools Function", () => {
    it("should return an array of read-only tool names", () => {
      const readOnlyTools = getIntegrationsReadOnlyToolNames();
      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it("should include only browse_integrations as read-only", () => {
      const readOnlyTools = getIntegrationsReadOnlyToolNames();
      expect(readOnlyTools).toContain("browse_integrations");
      expect(readOnlyTools).not.toContain("manage_integration");
    });

    it("should return exactly 1 tool", () => {
      const readOnlyTools = getIntegrationsReadOnlyToolNames();
      expect(readOnlyTools.length).toBe(1);
    });

    it("should return tools that exist in the registry", () => {
      const readOnlyTools = getIntegrationsReadOnlyToolNames();
      readOnlyTools.forEach(toolName => {
        expect(integrationsToolRegistry.has(toolName)).toBe(true);
      });
    });
  });

  describe("Integrations Tool Definitions Function", () => {
    it("should return an array of tool definitions", () => {
      const toolDefinitions = getIntegrationsToolDefinitions();
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions.length).toBe(2);
    });

    it("should return all tools from registry", () => {
      const toolDefinitions = getIntegrationsToolDefinitions();
      const registrySize = integrationsToolRegistry.size;
      expect(toolDefinitions.length).toBe(registrySize);
    });

    it("should return tool definitions with proper structure", () => {
      const toolDefinitions = getIntegrationsToolDefinitions();

      toolDefinitions.forEach(tool => {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("handler");
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.inputSchema).toBe("object");
      });
    });
  });

  describe("Filtered Integrations Tools Function", () => {
    it("should return all tools in normal mode", () => {
      const filteredTools = getFilteredIntegrationsTools(false);
      expect(filteredTools.length).toBe(2);
    });

    it("should return only browse_integrations in read-only mode", () => {
      const filteredTools = getFilteredIntegrationsTools(true);
      expect(filteredTools.length).toBe(1);

      const toolNames = filteredTools.map(tool => tool.name);
      expect(toolNames).toContain("browse_integrations");
      expect(toolNames).not.toContain("manage_integration");
    });
  });

  describe("browse_integrations Handler", () => {
    it("should handle list action with correct endpoint", async () => {
      const tool = integrationsToolRegistry.get("browse_integrations");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 1, slug: "slack", title: "Slack", active: true },
          { id: 2, slug: "jira", title: "Jira", active: true },
        ],
      } as Response);

      const result = await tool!.handler({
        action: "list",
        project_id: "test-project",
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining("projects/test-project/integrations")
      );
      expect(result).toBeDefined();
    });

    it("should handle list action with pagination parameters", async () => {
      const tool = integrationsToolRegistry.get("browse_integrations");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      await tool!.handler({
        action: "list",
        project_id: "test-project",
        per_page: 50,
        page: 2,
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining("per_page=50"));
      expect(mockEnhancedFetch).toHaveBeenCalledWith(expect.stringContaining("page=2"));
    });

    it("should URL-encode project path", async () => {
      const tool = integrationsToolRegistry.get("browse_integrations");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      await tool!.handler({
        action: "list",
        project_id: "my-group/my-project",
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining("projects/my-group%2Fmy-project/integrations")
      );
    });

    it("should handle get action for specific integration", async () => {
      const tool = integrationsToolRegistry.get("browse_integrations");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 1,
          slug: "slack",
          title: "Slack",
          active: true,
          properties: {},
        }),
      } as Response);

      const result = await tool!.handler({
        action: "get",
        project_id: "test-project",
        integration: "slack",
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining("projects/test-project/integrations/slack")
      );
      expect(result).toBeDefined();
    });
  });

  describe("manage_integration Handler - update action", () => {
    it("should call GitLab API with PUT method for update action", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 1,
          slug: "slack",
          title: "Slack",
          active: true,
        }),
      } as Response);

      const result = await tool!.handler({
        action: "update",
        project_id: "test-project",
        integration: "slack",
        active: true,
        push_events: true,
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining("projects/test-project/integrations/slack"),
        expect.objectContaining({
          method: "PUT",
        })
      );
      expect(result).toBeDefined();
    });

    it("should flatten config object in request body", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 1, slug: "slack" }),
      } as Response);

      await tool!.handler({
        action: "update",
        project_id: "test-project",
        integration: "slack",
        config: {
          webhook: "https://hooks.slack.com/xxx",
          channel: "#general",
        },
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining("webhook"),
        })
      );
    });
  });

  describe("manage_integration Handler - disable action", () => {
    it("should call GitLab API with DELETE method for disable action", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => undefined,
      } as Response);

      const result = await tool!.handler({
        action: "disable",
        project_id: "test-project",
        integration: "slack",
      });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining("projects/test-project/integrations/slack"),
        expect.objectContaining({
          method: "DELETE",
        })
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("manage_integration Handler - validation", () => {
    it("should reject missing project_id", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({
          action: "disable",
          integration: "slack",
        })
      ).rejects.toThrow();
    });

    it("should reject missing integration", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({
          action: "disable",
          project_id: "test-project",
        })
      ).rejects.toThrow();
    });

    it("should reject invalid integration type", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({
          action: "disable",
          project_id: "test-project",
          integration: "invalid-integration-type",
        })
      ).rejects.toThrow();
    });

    it("should reject invalid action", async () => {
      const tool = integrationsToolRegistry.get("manage_integration");
      expect(tool).toBeDefined();

      await expect(
        tool!.handler({
          action: "get", // Not a valid action for manage_integration (moved to browse_integrations)
          project_id: "test-project",
          integration: "slack",
        })
      ).rejects.toThrow();
    });
  });
});
