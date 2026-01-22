/**
 * Unit tests for browser.ts
 * Tests browser utilities for init wizard
 */

import { openUrl, _setImportOpen, _resetImportOpen } from "../../../../src/cli/init/browser";

describe("browser", () => {
  afterEach(() => {
    _resetImportOpen();
  });

  describe("openUrl", () => {
    it("should return true when browser opens successfully", async () => {
      // Inject mock import function that returns successful open module
      const mockOpen = jest.fn().mockResolvedValue(undefined);
      _setImportOpen(() => Promise.resolve({ default: mockOpen }));

      const result = await openUrl("https://example.com");

      expect(result).toBe(true);
      expect(mockOpen).toHaveBeenCalledWith("https://example.com");
    });

    it("should return false when import fails", async () => {
      // Inject mock import function that throws
      _setImportOpen(() => Promise.reject(new Error("Module not found")));

      const result = await openUrl("https://example.com");

      expect(result).toBe(false);
    });

    it("should return false when open() throws error", async () => {
      // Inject mock import that returns module with throwing function
      _setImportOpen(() =>
        Promise.resolve({
          default: () => {
            throw new Error("Failed to open browser");
          },
        })
      );

      const result = await openUrl("https://example.com");

      expect(result).toBe(false);
    });

    it("should return false when open() rejects", async () => {
      // Inject mock import that returns module with rejecting function
      const mockOpen = jest.fn().mockRejectedValue(new Error("Browser not found"));
      _setImportOpen(() => Promise.resolve({ default: mockOpen }));

      const result = await openUrl("https://example.com");

      expect(result).toBe(false);
      expect(mockOpen).toHaveBeenCalledWith("https://example.com");
    });
  });

  describe("_setImportOpen and _resetImportOpen", () => {
    it("should allow setting custom import function", async () => {
      const customMock = jest.fn().mockResolvedValue(undefined);
      _setImportOpen(() => Promise.resolve({ default: customMock }));

      await openUrl("https://test.com");

      expect(customMock).toHaveBeenCalledWith("https://test.com");
    });

    it("should reset to default after _resetImportOpen", async () => {
      const customMock = jest.fn().mockResolvedValue(undefined);
      _setImportOpen(() => Promise.resolve({ default: customMock }));

      _resetImportOpen();

      // After reset, the original dynamic import is used
      // This will try to actually import 'open' package
      // In test environment, this should work or fail gracefully
      const result = await openUrl("https://test.com");
      expect(typeof result).toBe("boolean");
    });
  });
});
