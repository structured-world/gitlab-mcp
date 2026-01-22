/**
 * Unit tests for cli/utils/path-utils.ts
 * Tests path expansion utilities
 */

import { expandPath } from "../../../../src/cli/utils/path-utils";
import { homedir } from "os";
import { join } from "path";

describe("path-utils", () => {
  describe("expandPath", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should expand home directory shortcut ~/", () => {
      const result = expandPath("~/Documents/config.json");
      expect(result).toBe(join(homedir(), "Documents/config.json"));
    });

    it("should expand nested home directory path", () => {
      const result = expandPath("~/.config/gitlab-mcp/settings.json");
      expect(result).toBe(join(homedir(), ".config/gitlab-mcp/settings.json"));
    });

    it("should return path unchanged if no home shortcut", () => {
      const absolutePath = "/usr/local/bin/test";
      const result = expandPath(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it("should handle empty path", () => {
      const result = expandPath("");
      expect(result).toBe("");
    });

    it("should handle path with only ~/", () => {
      const result = expandPath("~/");
      expect(result).toBe(join(homedir(), ""));
    });

    describe("Windows environment variables", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "win32" });
      });

      it("should expand Windows environment variables", () => {
        process.env.TEST_VAR = "test_value";
        const result = expandPath("%TEST_VAR%/config");
        expect(result).toBe("test_value/config");
        delete process.env.TEST_VAR;
      });

      it("should expand multiple Windows environment variables", () => {
        process.env.VAR1 = "first";
        process.env.VAR2 = "second";
        const result = expandPath("%VAR1%/%VAR2%/file.txt");
        expect(result).toBe("first/second/file.txt");
        delete process.env.VAR1;
        delete process.env.VAR2;
      });

      it("should handle missing Windows environment variable", () => {
        const result = expandPath("%NONEXISTENT_VAR%/config");
        expect(result).toBe("/config");
      });

      it("should handle both home directory and Windows env var", () => {
        process.env.APP_NAME = "myapp";
        const result = expandPath("~/%APP_NAME%/config");
        expect(result).toBe(join(homedir(), "myapp/config"));
        delete process.env.APP_NAME;
      });
    });

    describe("Non-Windows platforms", () => {
      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "darwin" });
      });

      it("should not expand Windows environment variables on non-Windows", () => {
        process.env.TEST_VAR = "test_value";
        const result = expandPath("%TEST_VAR%/config");
        expect(result).toBe("%TEST_VAR%/config");
        delete process.env.TEST_VAR;
      });
    });
  });
});
