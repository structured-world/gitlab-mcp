/**
 * Unit tests for OAuth Dynamic Client Registration endpoint
 */

import { Request, Response } from "express";
import {
  registerHandler,
  getRegisteredClient,
  isValidRedirectUri,
} from "../../../../src/oauth/endpoints/register";

// Mock logger
jest.mock("../../../../src/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

describe("OAuth Dynamic Client Registration", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonFn: jest.Mock;
  let statusFn: jest.Mock;

  beforeEach(() => {
    jsonFn = jest.fn();
    statusFn = jest.fn().mockReturnValue({ json: jsonFn });

    mockReq = {
      body: {},
    };
    mockRes = {
      status: statusFn,
      json: jsonFn,
    };

    jest.clearAllMocks();
  });

  describe("registerHandler", () => {
    it("should register a public client successfully", async () => {
      mockReq.body = {
        redirect_uris: ["https://example.com/callback"],
        client_name: "Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: expect.any(String),
          redirect_uris: ["https://example.com/callback"],
          client_name: "Test Client",
          token_endpoint_auth_method: "none",
        })
      );
      // Public clients should not have client_secret
      expect(jsonFn.mock.calls[0][0].client_secret).toBeUndefined();
    });

    it("should register a confidential client with secret", async () => {
      mockReq.body = {
        redirect_uris: ["https://example.com/callback"],
        client_name: "Confidential Client",
        token_endpoint_auth_method: "client_secret_post",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: expect.any(String),
          client_secret: expect.any(String),
          token_endpoint_auth_method: "client_secret_post",
        })
      );
    });

    it("should reject missing redirect_uris", async () => {
      mockReq.body = {
        client_name: "Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required and must be a non-empty array",
      });
    });

    it("should reject empty redirect_uris array", async () => {
      mockReq.body = {
        redirect_uris: [],
        client_name: "Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required and must be a non-empty array",
      });
    });

    it("should reject non-array redirect_uris", async () => {
      mockReq.body = {
        redirect_uris: "not-an-array",
        client_name: "Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required and must be a non-empty array",
      });
    });

    it("should reject invalid redirect URI", async () => {
      mockReq.body = {
        redirect_uris: ["not-a-valid-url"],
        client_name: "Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: "invalid_redirect_uri",
        error_description: "Invalid redirect URI: not-a-valid-url",
      });
    });

    it("should use default grant_types and response_types", async () => {
      mockReq.body = {
        redirect_uris: ["https://example.com/callback"],
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        })
      );
    });

    it("should handle multiple redirect_uris", async () => {
      mockReq.body = {
        redirect_uris: ["https://example.com/callback", "https://example.com/oauth/callback"],
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uris: ["https://example.com/callback", "https://example.com/oauth/callback"],
        })
      );
    });

    it("should handle unexpected errors", async () => {
      // Create a getter that throws on access to body
      const badReq = {
        get body() {
          throw new Error("Unexpected error");
        },
      } as unknown as Request;

      await registerHandler(badReq, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith({
        error: "server_error",
        error_description: "Failed to register client",
      });
    });
  });

  describe("getRegisteredClient", () => {
    it("should return undefined for unregistered client", () => {
      const client = getRegisteredClient("non-existent-client-id");
      expect(client).toBeUndefined();
    });

    it("should return registered client data", async () => {
      mockReq.body = {
        redirect_uris: ["https://example.com/callback"],
        client_name: "Lookup Test Client",
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const client = getRegisteredClient(registeredClientId);
      expect(client).toBeDefined();
      expect(client?.client_name).toBe("Lookup Test Client");
    });
  });

  describe("isValidRedirectUri", () => {
    it("should return true for unregistered client (backward compatibility)", () => {
      const isValid = isValidRedirectUri("unknown-client", "https://any-uri.com/callback");
      expect(isValid).toBe(true);
    });

    it("should return true for valid redirect URI", async () => {
      mockReq.body = {
        redirect_uris: ["https://valid.com/callback"],
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const isValid = isValidRedirectUri(registeredClientId, "https://valid.com/callback");
      expect(isValid).toBe(true);
    });

    it("should return false for invalid redirect URI", async () => {
      mockReq.body = {
        redirect_uris: ["https://valid.com/callback"],
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const isValid = isValidRedirectUri(registeredClientId, "https://different.com/callback");
      expect(isValid).toBe(false);
    });
  });
});
