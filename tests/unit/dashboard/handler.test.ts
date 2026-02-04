/**
 * Unit tests for Dashboard HTTP Handler
 * Tests Accept header content negotiation and response formatting
 */

import { Request, Response } from "express";
import { dashboardHandler } from "../../../src/dashboard/handler";

// Mock the metrics and html-template modules
jest.mock("../../../src/dashboard/metrics", () => ({
  collectMetrics: jest.fn(() => ({
    server: {
      version: "6.52.0",
      uptime: 3600,
      mode: "oauth",
      readOnly: false,
      toolsEnabled: 44,
      toolsTotal: 44,
    },
    instances: [],
    sessions: {
      total: 5,
      byInstance: {},
    },
    config: {
      source: "env",
      sourceDetails: "GITLAB_API_URL",
      oauthEnabled: true,
    },
  })),
}));

jest.mock("../../../src/dashboard/html-template", () => ({
  renderDashboard: jest.fn(() => "<html><body>Dashboard</body></html>"),
}));

jest.mock("../../../src/logger", () => ({
  logDebug: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("Dashboard Handler", () => {
  // Helper to create mock request
  function createMockRequest(accept?: string): Partial<Request> {
    return {
      headers: accept !== undefined ? { accept } : {},
    };
  }

  // Helper to create mock response
  function createMockResponse(): Partial<Response> & {
    typeCalled: string | undefined;
    sendCalled: string | undefined;
    jsonCalled: unknown;
  } {
    const res: Partial<Response> & {
      typeCalled: string | undefined;
      sendCalled: string | undefined;
      jsonCalled: unknown;
    } = {
      typeCalled: undefined,
      sendCalled: undefined,
      jsonCalled: undefined,
      type: jest.fn(function (this: typeof res, contentType: string) {
        this.typeCalled = contentType;
        return this as Response;
      }),
      send: jest.fn(function (this: typeof res, body: string) {
        this.sendCalled = body;
        return this as Response;
      }),
      json: jest.fn(function (this: typeof res, data: unknown) {
        this.jsonCalled = data;
        return this as Response;
      }),
    };
    return res;
  }

  describe("Content negotiation", () => {
    it("should return HTML for Accept: text/html", () => {
      const req = createMockRequest("text/html");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.type).toHaveBeenCalledWith("text/html");
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return HTML for Accept: */* (browser default)", () => {
      const req = createMockRequest("*/*");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.type).toHaveBeenCalledWith("text/html");
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return HTML when no Accept header is present", () => {
      const req = createMockRequest(undefined);
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.type).toHaveBeenCalledWith("text/html");
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return JSON for Accept: application/json", () => {
      const req = createMockRequest("application/json");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
      expect(res.type).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it("should return HTML when both text/html and application/json are accepted (HTML preferred)", () => {
      const req = createMockRequest("text/html, application/json");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.type).toHaveBeenCalledWith("text/html");
      expect(res.send).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should return JSON when only application/json is accepted", () => {
      const req = createMockRequest("application/json, text/plain");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.json).toHaveBeenCalled();
      expect(res.type).not.toHaveBeenCalled();
    });

    it("should return HTML for complex browser Accept header", () => {
      // Typical browser Accept header
      const req = createMockRequest(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      );
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.type).toHaveBeenCalledWith("text/html");
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe("Response content", () => {
    it("should return collected metrics in JSON response", () => {
      const req = createMockRequest("application/json");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.jsonCalled).toBeDefined();
      expect((res.jsonCalled as { server: { version: string } }).server.version).toBe("6.52.0");
    });

    it("should return rendered HTML in HTML response", () => {
      const req = createMockRequest("text/html");
      const res = createMockResponse();

      dashboardHandler(req as Request, res as unknown as Response);

      expect(res.sendCalled).toContain("Dashboard");
    });
  });
});
