/**
 * Unit tests for docker/container-runtime.ts
 * Tests container runtime detection, caching, and compose command resolution.
 */

import * as childProcess from "child_process";
import {
  detectContainerRuntime,
  getContainerRuntime,
  resetRuntimeCache,
} from "../../../../src/cli/docker/container-runtime";

jest.mock("child_process");

const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

// Helper to create a successful spawnSync result
function successResult(stdout: string) {
  return {
    status: 0,
    stdout,
    stderr: "",
    pid: 123,
    output: [],
    signal: null,
  };
}

// Helper to create a failed spawnSync result
function failResult(stderr = "") {
  return {
    status: 1,
    stdout: "",
    stderr,
    pid: 123,
    output: [],
    signal: null,
  };
}

describe("container-runtime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRuntimeCache();
  });

  describe("detectContainerRuntime", () => {
    it("should detect Docker when docker --version succeeds", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7, build afdd53b") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("Docker Compose version v2.21.0") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
      expect(result.runtimeCmd).toBe("docker");
      expect(result.runtimeAvailable).toBe(true);
      expect(result.runtimeVersion).toBe("24.0.7");
      expect(result.composeCmd).toEqual(["docker", "compose"]);
    });

    it("should detect Podman when Docker is not available", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker") {
          return failResult("command not found") as any;
        }
        if (cmd === "podman" && args?.[0] === "--version") {
          return successResult("podman version 4.9.3") as any;
        }
        if (cmd === "podman" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "podman" && args?.[0] === "compose") {
          return successResult("podman compose version 1.0.6") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("podman");
      expect(result.runtimeCmd).toBe("podman");
      expect(result.runtimeAvailable).toBe(true);
      expect(result.runtimeVersion).toBe("4.9.3");
      expect(result.composeCmd).toEqual(["podman", "compose"]);
    });

    it("should prefer Docker over Podman when both are available", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("Docker Compose version v2.21.0") as any;
        }
        // Podman is also available but should not be reached for runtime detection
        if (cmd === "podman" && args?.[0] === "--version") {
          return successResult("podman version 4.9.3") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
    });

    it("should return unavailable runtime when no runtime is found", () => {
      mockChildProcess.spawnSync.mockReturnValue(failResult() as any);

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
      expect(result.runtimeAvailable).toBe(false);
      expect(result.runtimeVersion).toBeUndefined();
      expect(result.composeCmd).toBeNull();
    });

    it("should detect runtime installed but daemon not running", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return failResult("Cannot connect to Docker daemon") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("Docker Compose version v2.21.0") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
      expect(result.runtimeVersion).toBe("24.0.7");
      expect(result.runtimeAvailable).toBe(false);
      expect(result.composeCmd).toEqual(["docker", "compose"]);
    });

    it("should detect docker-compose v1 standalone as fallback", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 20.10.0") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        // docker compose v2 not available
        if (cmd === "docker" && args?.[0] === "compose") {
          return failResult("is not a docker command") as any;
        }
        // docker-compose v1 available
        if (cmd === "docker-compose" && args?.[0] === "--version") {
          return successResult("docker-compose version 1.29.2") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.composeCmd).toEqual(["docker-compose"]);
    });

    it("should detect podman-compose standalone for podman runtime", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker") {
          return failResult("command not found") as any;
        }
        if (cmd === "podman" && args?.[0] === "--version") {
          return successResult("podman version 4.9.3") as any;
        }
        if (cmd === "podman" && args?.[0] === "info") {
          return successResult("") as any;
        }
        // podman compose plugin not available
        if (cmd === "podman" && args?.[0] === "compose") {
          return failResult() as any;
        }
        // podman-compose standalone available
        if (cmd === "podman-compose" && args?.[0] === "--version") {
          return successResult("podman-compose version 1.0.6") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("podman");
      expect(result.composeCmd).toEqual(["podman-compose"]);
    });

    it("should use docker-compose as cross-runtime fallback for podman", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return failResult() as any;
        }
        if (cmd === "podman" && args?.[0] === "--version") {
          return successResult("podman version 4.9.3") as any;
        }
        if (cmd === "podman" && args?.[0] === "info") {
          return successResult("") as any;
        }
        // No podman compose, no podman-compose
        if (cmd === "podman" && args?.[0] === "compose") {
          return failResult() as any;
        }
        if (cmd === "podman-compose") {
          return failResult() as any;
        }
        // docker-compose v1 is available as fallback
        if (cmd === "docker-compose" && args?.[0] === "--version") {
          return successResult("docker-compose version 1.29.2") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("podman");
      expect(result.composeCmd).toEqual(["docker-compose"]);
    });

    it("should return null composeCmd when no compose tool found", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        // No compose available at all
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
      expect(result.runtimeAvailable).toBe(true);
      expect(result.composeCmd).toBeNull();
    });

    it("should handle spawnSync throwing exceptions gracefully", () => {
      mockChildProcess.spawnSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = detectContainerRuntime();

      expect(result.runtime).toBe("docker");
      expect(result.runtimeAvailable).toBe(false);
      expect(result.runtimeVersion).toBeUndefined();
      expect(result.composeCmd).toBeNull();
    });

    it("should parse version from complex version strings", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 26.1.3-ce, build b72abbb") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("") as any;
        }
        return failResult() as any;
      });

      const result = detectContainerRuntime();

      expect(result.runtimeVersion).toBe("26.1.3");
    });

    it("should handle exception in daemon check gracefully", () => {
      // docker --version succeeds, but docker info throws (e.g. permission error)
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          throw new Error("permission denied");
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          throw new Error("permission denied");
        }
        throw new Error("not found");
      });

      const result = detectContainerRuntime();

      // Runtime detected but unavailable due to thrown error
      expect(result.runtime).toBe("docker");
      expect(result.runtimeVersion).toBe("24.0.7");
      expect(result.runtimeAvailable).toBe(false);
      expect(result.composeCmd).toBeNull();
    });
  });

  describe("getContainerRuntime (caching)", () => {
    it("should cache the result across multiple calls", () => {
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("") as any;
        }
        return failResult() as any;
      });

      const first = getContainerRuntime();
      const second = getContainerRuntime();

      expect(first).toBe(second);
      // spawnSync should only be called for the first detection
      const callCount = mockChildProcess.spawnSync.mock.calls.length;
      expect(callCount).toBeGreaterThan(0);

      // Call again — no additional spawnSync calls
      getContainerRuntime();
      expect(mockChildProcess.spawnSync.mock.calls.length).toBe(callCount);
    });
  });

  describe("resetRuntimeCache", () => {
    it("should allow re-detection after reset", () => {
      // First: Docker detected
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker" && args?.[0] === "--version") {
          return successResult("Docker version 24.0.7") as any;
        }
        if (cmd === "docker" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "docker" && args?.[0] === "compose") {
          return successResult("") as any;
        }
        return failResult() as any;
      });

      const first = getContainerRuntime();
      expect(first.runtime).toBe("docker");

      // Reset cache and change mock to only have podman
      resetRuntimeCache();
      mockChildProcess.spawnSync.mockImplementation((cmd, args) => {
        if (cmd === "docker") {
          return failResult() as any;
        }
        if (cmd === "podman" && args?.[0] === "--version") {
          return successResult("podman version 4.9.3") as any;
        }
        if (cmd === "podman" && args?.[0] === "info") {
          return successResult("") as any;
        }
        if (cmd === "podman" && args?.[0] === "compose") {
          return successResult("") as any;
        }
        return failResult() as any;
      });

      const second = getContainerRuntime();
      expect(second.runtime).toBe("podman");
    });
  });
});
