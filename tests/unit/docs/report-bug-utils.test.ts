/**
 * Unit tests for the bug report API utility functions.
 * Tests validation, CORS, and encoding logic without Cloudflare runtime.
 */

// Import the pure functions from utils
import {
  validateReport,
  corsHeaders,
  base64url,
  asn1Length,
  concatBuffers,
  ALLOWED_ORIGINS,
  CATEGORIES,
  MIN_DESCRIPTION_LENGTH,
} from "../../../docs/functions/api/utils";

describe("report-bug utils", () => {
  describe("validateReport", () => {
    // Tests that valid input produces a successful validation result
    it("accepts valid input with all fields", () => {
      const result = validateReport({
        page: "/guide/quick-start",
        description: "The example code does not work as shown",
        expected: "Should display a list of projects",
        category: "Tool not working as described",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.page).toBe("/guide/quick-start");
        expect(result.report.description).toBe("The example code does not work as shown");
        expect(result.report.expected).toBe("Should display a list of projects");
        expect(result.report.category).toBe("Tool not working as described");
      }
    });

    // Tests that only description is required
    it("accepts input with only required description field", () => {
      const result = validateReport({
        description: "Something is broken here",
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.page).toBe("/unknown");
        expect(result.report.expected).toBeUndefined();
        expect(result.report.category).toBeUndefined();
      }
    });

    // Tests null/undefined rejection
    it("rejects null or undefined input", () => {
      expect(validateReport(null)).toEqual({ valid: false, error: "Invalid request body" });
      expect(validateReport(undefined)).toEqual({ valid: false, error: "Invalid request body" });
    });

    // Tests non-object rejection
    it("rejects non-object input", () => {
      expect(validateReport("string")).toEqual({ valid: false, error: "Invalid request body" });
      expect(validateReport(42)).toEqual({ valid: false, error: "Invalid request body" });
    });

    // Tests missing description field
    it("rejects missing description", () => {
      const result = validateReport({ page: "/test" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Description is required");
      }
    });

    // Tests description minimum length enforcement
    it("rejects description shorter than minimum length", () => {
      const result = validateReport({ description: "short" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain(`at least ${MIN_DESCRIPTION_LENGTH}`);
      }
    });

    // Tests honeypot anti-spam detection
    it("rejects non-empty honeypot field (anti-spam)", () => {
      const result = validateReport({
        description: "This is a valid description",
        honeypot: "spam bot filled this",
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("Invalid submission");
      }
    });

    // Tests that empty honeypot is allowed
    it("allows empty honeypot field", () => {
      const result = validateReport({
        description: "This is a valid description",
        honeypot: "",
      });
      expect(result.valid).toBe(true);
    });

    // Tests invalid category rejection
    it("ignores invalid category values", () => {
      const result = validateReport({
        description: "This is a valid description",
        category: "Not a real category",
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.category).toBeUndefined();
      }
    });

    // Tests all valid categories are accepted
    it("accepts all valid category values", () => {
      for (const cat of CATEGORIES) {
        const result = validateReport({
          description: "Valid description text",
          category: cat,
        });
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.report.category).toBe(cat);
        }
      }
    });

    // Tests page path sanitization (truncation)
    it("truncates page path to 200 characters", () => {
      const longPage = "/guide/" + "a".repeat(300);
      const result = validateReport({
        page: longPage,
        description: "Valid description text",
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.page.length).toBe(200);
      }
    });

    // Tests description truncation
    it("truncates description to 2000 characters", () => {
      const longDesc = "x".repeat(3000);
      const result = validateReport({
        description: longDesc,
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.description.length).toBe(2000);
      }
    });

    // Tests whitespace trimming in description
    it("trims whitespace from description", () => {
      const result = validateReport({
        description: "   Valid description with spaces   ",
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.report.description).toBe("Valid description with spaces");
      }
    });

    // Tests that whitespace-only description fails minimum length check
    it("rejects whitespace-only description as too short", () => {
      const result = validateReport({
        description: "         ",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("corsHeaders", () => {
    // Tests that allowed origins get their own origin back
    it("returns matching origin for allowed origins", () => {
      for (const origin of ALLOWED_ORIGINS) {
        const headers = corsHeaders(origin);
        expect(headers["Access-Control-Allow-Origin"]).toBe(origin);
      }
    });

    // Tests that unknown origins fall back to primary allowed origin
    it("falls back to first allowed origin for unknown origins", () => {
      const headers = corsHeaders("https://evil.com");
      expect(headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGINS[0]);
    });

    // Tests that required CORS headers are present
    it("includes required CORS headers", () => {
      const headers = corsHeaders("https://structured-world.github.io");
      expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
      expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type");
      expect(headers["Access-Control-Max-Age"]).toBe("86400");
    });
  });

  describe("base64url", () => {
    // Tests standard base64url encoding of strings
    it("encodes strings to base64url format", () => {
      const result = base64url('{"alg":"RS256","typ":"JWT"}');
      // base64url should not contain +, /, or = characters
      expect(result).not.toMatch(/[+/=]/);
      expect(result.length).toBeGreaterThan(0);
    });

    // Tests that padding is stripped
    it("strips padding characters", () => {
      // "a" in base64 is "YQ==" — should become "YQ"
      const result = base64url("a");
      expect(result).not.toContain("=");
      expect(result).toBe("YQ");
    });

    // Tests ArrayBuffer encoding
    it("encodes ArrayBuffer to base64url", () => {
      const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      const result = base64url(buffer);
      expect(result).not.toMatch(/[+/=]/);
      expect(result).toBe("SGVsbG8"); // base64url of "Hello"
    });

    // Tests that + and / are replaced
    it("replaces + with - and / with _", () => {
      // Use input that produces + and / in standard base64
      // ">>>" in base64 is "Pj4+" and "???" is "Pz8/"
      const result = base64url(">>>");
      expect(result).not.toContain("+");
      // Verify it contains the replacement
      expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("asn1Length", () => {
    // Tests short-form encoding (< 128)
    it("encodes short lengths in single byte", () => {
      expect(asn1Length(0)).toEqual(new Uint8Array([0]));
      expect(asn1Length(1)).toEqual(new Uint8Array([1]));
      expect(asn1Length(127)).toEqual(new Uint8Array([127]));
    });

    // Tests long-form encoding (>= 128)
    it("encodes long lengths with length-of-length prefix", () => {
      const result = asn1Length(128);
      // 128 = 0x80, needs 1 byte, so prefix is 0x81
      expect(result[0]).toBe(0x81);
      expect(result[1]).toBe(0x80);
    });

    // Tests multi-byte long-form
    it("handles multi-byte lengths", () => {
      const result = asn1Length(256);
      // 256 = 0x0100, needs 2 bytes, so prefix is 0x82
      expect(result[0]).toBe(0x82);
      expect(result[1]).toBe(0x01);
      expect(result[2]).toBe(0x00);
    });
  });

  describe("concatBuffers", () => {
    // Tests concatenation of multiple arrays
    it("concatenates multiple Uint8Arrays", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4, 5]);
      const c = new Uint8Array([6]);

      const result = concatBuffers(a, b, c);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    // Tests empty array handling
    it("handles empty arrays", () => {
      const a = new Uint8Array([1, 2]);
      const empty = new Uint8Array([]);

      const result = concatBuffers(a, empty, a);
      expect(result).toEqual(new Uint8Array([1, 2, 1, 2]));
    });

    // Tests single array passthrough
    it("handles single array", () => {
      const a = new Uint8Array([42, 43]);
      const result = concatBuffers(a);
      expect(result).toEqual(new Uint8Array([42, 43]));
    });
  });
});
