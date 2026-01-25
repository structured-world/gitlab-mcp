/**
 * Unit tests for logger module helper functions
 *
 * Tests logInfo, logWarn, logError, logDebug functions
 * which provide consistent logging pattern for both JSON and plain modes.
 */

import { jest } from "@jest/globals";

// Store original env
const originalEnv = { ...process.env };

describe("logger", () => {
  // Mock pino logger methods
  const mockInfo = jest.fn();
  const mockWarn = jest.fn();
  const mockError = jest.fn();
  const mockDebug = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Reset env vars
    delete process.env.LOG_JSON;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("logInfo", () => {
    it("should log message only when no data provided (plain mode)", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message");

      expect(mockInfo).toHaveBeenCalledWith("Test message");
    });

    it("should log message with key=value pairs when data provided (plain mode)", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message", { key: "value", count: 42 });

      expect(mockInfo).toHaveBeenCalledWith("Test message key=value count=42");
    });

    it("should log structured JSON when LOG_JSON=true", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message", { key: "value" });

      expect(mockInfo).toHaveBeenCalledWith({ key: "value" }, "Test message");
    });

    it("should log empty object when LOG_JSON=true and no data", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message");

      expect(mockInfo).toHaveBeenCalledWith({}, "Test message");
    });

    it("should handle nested objects in data", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message", { nested: { a: 1, b: 2 } });

      expect(mockInfo).toHaveBeenCalledWith('Test message nested={"a":1,"b":2}');
    });

    it("should handle empty data object", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test message", {});

      expect(mockInfo).toHaveBeenCalledWith("Test message");
    });
  });

  describe("logWarn", () => {
    it("should log message only when no data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logWarn } = await import("../../src/logger");
      logWarn("Warning message");

      expect(mockWarn).toHaveBeenCalledWith("Warning message");
    });

    it("should log with key=value pairs when data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logWarn } = await import("../../src/logger");
      logWarn("Warning message", { code: "WARN_001" });

      expect(mockWarn).toHaveBeenCalledWith("Warning message code=WARN_001");
    });

    it("should log structured JSON when LOG_JSON=true", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logWarn } = await import("../../src/logger");
      logWarn("Warning", { code: "W1" });

      expect(mockWarn).toHaveBeenCalledWith({ code: "W1" }, "Warning");
    });
  });

  describe("logError", () => {
    it("should log message only when no data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logError } = await import("../../src/logger");
      logError("Error occurred");

      expect(mockError).toHaveBeenCalledWith("Error occurred");
    });

    it("should log with key=value pairs when data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logError } = await import("../../src/logger");
      logError("Error occurred", { error: "Something failed" });

      expect(mockError).toHaveBeenCalledWith("Error occurred error=Something failed");
    });

    it("should log structured JSON when LOG_JSON=true", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logError } = await import("../../src/logger");
      logError("Error", { stack: "trace" });

      expect(mockError).toHaveBeenCalledWith({ stack: "trace" }, "Error");
    });
  });

  describe("logDebug", () => {
    it("should log message only when no data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logDebug } = await import("../../src/logger");
      logDebug("Debug info");

      expect(mockDebug).toHaveBeenCalledWith("Debug info");
    });

    it("should log with key=value pairs when data provided", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logDebug } = await import("../../src/logger");
      logDebug("Debug info", { requestId: "abc123" });

      expect(mockDebug).toHaveBeenCalledWith("Debug info requestId=abc123");
    });

    it("should log structured JSON when LOG_JSON=true", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logDebug } = await import("../../src/logger");
      logDebug("Debug", { id: 123 });

      expect(mockDebug).toHaveBeenCalledWith({ id: 123 }, "Debug");
    });
  });

  describe("formatDataPairs", () => {
    it("should handle various data types", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test", {
        str: "text",
        num: 42,
        bool: true,
        nullVal: null,
        arr: [1, 2, 3],
      });

      expect(mockInfo).toHaveBeenCalledWith(
        "Test str=text num=42 bool=true nullVal=null arr=[1,2,3]"
      );
    });

    it("should handle Error objects preserving message and stack", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logError } = await import("../../src/logger");
      const testError = new Error("Something went wrong");
      logError("Operation failed", { err: testError });

      // Error should be formatted with stack trace, not as "{}"
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining("Operation failed err=Error: Something went wrong")
      );
    });

    it("should handle undefined values", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { logInfo } = await import("../../src/logger");
      logInfo("Test", { value: undefined });

      expect(mockInfo).toHaveBeenCalledWith("Test value=undefined");
    });
  });

  describe("LOG_JSON constant", () => {
    it("should be false by default", async () => {
      delete process.env.LOG_JSON;

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { LOG_JSON } = await import("../../src/logger");
      expect(LOG_JSON).toBe(false);
    });

    it("should be true when LOG_JSON=true", async () => {
      process.env.LOG_JSON = "true";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { LOG_JSON } = await import("../../src/logger");
      expect(LOG_JSON).toBe(true);
    });
  });

  describe("LOG_FORMAT constant", () => {
    it("should default to '%msg' (minimal format)", async () => {
      delete process.env.LOG_FORMAT;

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { LOG_FORMAT } = await import("../../src/logger");
      expect(LOG_FORMAT).toBe("%msg");
    });

    it("should use custom format when LOG_FORMAT is set", async () => {
      process.env.LOG_FORMAT = "full";

      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { LOG_FORMAT } = await import("../../src/logger");
      expect(LOG_FORMAT).toBe("full");
    });
  });

  describe("truncateId", () => {
    it("should truncate long IDs to first4..last4 format", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { truncateId } = await import("../../src/logger");

      // "abcdefghijklmnop" (16 chars) -> "abcd..mnop"
      expect(truncateId("abcdefghijklmnop")).toBe("abcd..mnop");

      // UUID-like: "550e8400-e29b-41d4-a716-446655440000" -> "550e..0000"
      expect(truncateId("550e8400-e29b-41d4-a716-446655440000")).toBe("550e..0000");
    });

    it("should return short IDs unchanged (<=10 chars)", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { truncateId } = await import("../../src/logger");

      expect(truncateId("short")).toBe("short");
      expect(truncateId("1234567890")).toBe("1234567890");
    });

    it("should truncate 11+ character IDs", async () => {
      jest.doMock("pino", () => ({
        pino: jest.fn(() => ({
          info: mockInfo,
          warn: mockWarn,
          error: mockError,
          debug: mockDebug,
        })),
      }));

      const { truncateId } = await import("../../src/logger");

      // "12345678901" (11 chars) -> "1234..8901"
      expect(truncateId("12345678901")).toBe("1234..8901");
    });
  });
});
