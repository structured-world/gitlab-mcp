/**
 * Unit tests for docker/docker-command.ts
 * Tests Docker command parsing
 */

import { parseDockerSubcommand, DockerSubcommand } from "../../../../src/cli/docker/docker-command";

describe("docker-command", () => {
  describe("parseDockerSubcommand", () => {
    it("should parse status subcommand", () => {
      const result = parseDockerSubcommand(["status"]);
      expect(result.subcommand).toBe("status");
      expect(result.subArgs).toEqual([]);
    });

    it("should parse init subcommand", () => {
      const result = parseDockerSubcommand(["init"]);
      expect(result.subcommand).toBe("init");
    });

    it("should parse start subcommand", () => {
      const result = parseDockerSubcommand(["start"]);
      expect(result.subcommand).toBe("start");
    });

    it("should parse stop subcommand", () => {
      const result = parseDockerSubcommand(["stop"]);
      expect(result.subcommand).toBe("stop");
    });

    it("should parse restart subcommand", () => {
      const result = parseDockerSubcommand(["restart"]);
      expect(result.subcommand).toBe("restart");
    });

    it("should parse upgrade subcommand", () => {
      const result = parseDockerSubcommand(["upgrade"]);
      expect(result.subcommand).toBe("upgrade");
    });

    it("should parse logs subcommand", () => {
      const result = parseDockerSubcommand(["logs"]);
      expect(result.subcommand).toBe("logs");
    });

    it("should parse logs subcommand with -f flag", () => {
      const result = parseDockerSubcommand(["logs", "-f"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["-f"]);
    });

    it("should parse logs subcommand with --follow flag", () => {
      const result = parseDockerSubcommand(["logs", "--follow"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["--follow"]);
    });

    it("should parse logs subcommand with --lines flag", () => {
      const result = parseDockerSubcommand(["logs", "--lines=200"]);
      expect(result.subcommand).toBe("logs");
      expect(result.subArgs).toEqual(["--lines=200"]);
    });

    it("should parse add-instance subcommand", () => {
      const result = parseDockerSubcommand(["add-instance"]);
      expect(result.subcommand).toBe("add-instance");
    });

    it("should parse add-instance subcommand with host argument", () => {
      const result = parseDockerSubcommand(["add-instance", "gitlab.company.com"]);
      expect(result.subcommand).toBe("add-instance");
      expect(result.subArgs).toEqual(["gitlab.company.com"]);
    });

    it("should parse remove-instance subcommand", () => {
      const result = parseDockerSubcommand(["remove-instance"]);
      expect(result.subcommand).toBe("remove-instance");
    });

    it("should parse remove-instance subcommand with host argument", () => {
      const result = parseDockerSubcommand(["remove-instance", "gitlab.company.com"]);
      expect(result.subcommand).toBe("remove-instance");
      expect(result.subArgs).toEqual(["gitlab.company.com"]);
    });

    it("should return undefined for unknown subcommand", () => {
      const result = parseDockerSubcommand(["unknown-command"]);
      expect(result.subcommand).toBeUndefined();
      expect(result.subArgs).toEqual(["unknown-command"]);
    });

    it("should return undefined for empty args", () => {
      const result = parseDockerSubcommand([]);
      expect(result.subcommand).toBeUndefined();
      expect(result.subArgs).toEqual([]);
    });

    it("should handle all valid subcommands", () => {
      const validSubcommands: DockerSubcommand[] = [
        "status",
        "init",
        "start",
        "stop",
        "restart",
        "upgrade",
        "logs",
        "add-instance",
        "remove-instance",
      ];

      for (const cmd of validSubcommands) {
        const result = parseDockerSubcommand([cmd]);
        expect(result.subcommand).toBe(cmd);
      }
    });
  });
});
