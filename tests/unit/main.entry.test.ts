import { jest } from "@jest/globals";

// Mock server and logger before importing main
jest.mock("../../src/server", () => ({
  startServer: jest.fn(),
}));

jest.mock("../../src/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock profiles module to prevent file system access during tests
jest.mock("../../src/profiles", () => ({
  tryApplyProfileFromEnv: jest.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
}));

// Mock cli/init to prevent ESM 'open' package from being imported
const mockRunWizard = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
jest.mock("../../src/cli/init", () => ({
  runWizard: mockRunWizard,
}));

// Mock cli-utils for parseCliArgs with full CliArgs shape
jest.mock("../../src/cli-utils", () => ({
  parseCliArgs: jest.fn(() => ({
    init: false,
    noProjectConfig: false,
    showProjectConfig: false,
    auto: false,
  })),
}));

const mockStartServer = jest.fn<() => Promise<void>>();
const mockLogger = { error: jest.fn() };

// Mock process.exit to prevent tests from actually exiting
const mockExit = jest
  .spyOn(process, "exit")
  .mockImplementation((_code?: number) => undefined as never);

describe("main entry point", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset mocks
    const { startServer } = require("../../src/server");
    const { logger } = require("../../src/logger");

    startServer.mockImplementation(mockStartServer);
    logger.error.mockImplementation(mockLogger.error);
  });

  afterEach(() => {
    mockExit.mockClear();
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  it("should call startServer successfully", async () => {
    mockStartServer.mockResolvedValue(undefined);

    // Import main after setting up mocks
    await import("../../src/main");

    // Give it a moment to execute
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockStartServer).toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should handle startServer errors and exit with code 1", async () => {
    const testError = new Error("Server startup failed");
    mockStartServer.mockRejectedValue(testError);

    // Import main after setting up mocks
    await import("../../src/main");

    // Give it a moment to execute the catch block
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockStartServer).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to start GitLab MCP Server: Error: Server startup failed"
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should run init wizard and exit when init subcommand is used", async () => {
    // Reset modules to ensure fresh import
    jest.resetModules();

    // Create mocks first
    const mockWizard = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    // Re-apply mocks after reset with full CliArgs shape
    jest.doMock("../../src/cli-utils", () => ({
      parseCliArgs: jest.fn(() => ({
        init: true,
        noProjectConfig: false,
        showProjectConfig: false,
        auto: false,
      })),
    }));
    jest.doMock("../../src/server", () => ({
      startServer: jest.fn(),
    }));
    jest.doMock("../../src/logger", () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    }));
    jest.doMock("../../src/profiles", () => ({
      tryApplyProfileFromEnv: jest.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
    }));
    jest.doMock("../../src/cli/init", () => ({
      runWizard: mockWizard,
    }));

    // Import main after setting up mocks
    await import("../../src/main");

    // Give it a moment to execute
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify runWizard was called and process.exit(0) was called
    // Note: In tests, process.exit is mocked and doesn't stop execution,
    // so we can only verify that exit(0) was called after runWizard
    expect(mockWizard).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
