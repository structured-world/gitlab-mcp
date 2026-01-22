/**
 * Unit tests for server-setup flow
 */

import * as p from "@clack/prompts";

jest.mock("@clack/prompts", () => ({
  select: jest.fn(),
  confirm: jest.fn(),
  text: jest.fn(),
  spinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
  note: jest.fn(),
  isCancel: jest.fn().mockReturnValue(false),
}));

jest.mock("../../../../../src/cli/docker/docker-utils", () => ({
  initDockerConfig: jest.fn(),
  startContainer: jest.fn().mockReturnValue({ success: true }),
}));

jest.mock("../../../../../src/cli/docker/types", () => ({
  DEFAULT_DOCKER_CONFIG: { port: 3333, image: "ghcr.io/structured-world/gitlab-mcp:latest" },
}));

jest.mock("../../../../../src/cli/setup/flows/tool-selection", () => ({
  runToolSelectionFlow: jest
    .fn()
    .mockResolvedValue({ mode: "preset", preset: "developer", enabledCategories: ["core"] }),
  applyManualCategories: jest.fn(),
}));

import { runServerSetupFlow } from "../../../../../src/cli/setup/flows/server-setup";
import { DiscoveryResult } from "../../../../../src/cli/setup/types";
import { initDockerConfig, startContainer } from "../../../../../src/cli/docker/docker-utils";
import {
  runToolSelectionFlow,
  applyManualCategories,
} from "../../../../../src/cli/setup/flows/tool-selection";

const mockSelect = p.select as jest.MockedFunction<typeof p.select>;
const mockConfirm = p.confirm as jest.MockedFunction<typeof p.confirm>;
const mockText = p.text as jest.MockedFunction<typeof p.text>;
const mockIsCancel = p.isCancel as jest.MockedFunction<typeof p.isCancel>;

const dockerReadyDiscovery: DiscoveryResult = {
  clients: { detected: [], configured: [], unconfigured: [] },
  docker: { dockerInstalled: true, dockerRunning: true, composeInstalled: true, instances: [] },
  summary: {
    hasExistingSetup: false,
    clientCount: 0,
    configuredCount: 0,
    dockerRunning: true,
    containerExists: false,
  },
};

describe("flows/server-setup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
  });

  it("should fail when Docker is not installed", async () => {
    const discovery: DiscoveryResult = {
      ...dockerReadyDiscovery,
      docker: { ...dockerReadyDiscovery.docker, dockerInstalled: false },
    };

    const result = await runServerSetupFlow(discovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Docker not installed");
  });

  it("should fail when Docker Compose is not installed", async () => {
    const discovery: DiscoveryResult = {
      ...dockerReadyDiscovery,
      docker: { ...dockerReadyDiscovery.docker, composeInstalled: false },
    };

    const result = await runServerSetupFlow(discovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Docker Compose not installed");
  });

  it("should return cancelled when deployment type is cancelled", async () => {
    mockIsCancel.mockReturnValueOnce(true);
    mockSelect.mockResolvedValueOnce(Symbol("cancel"));

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when port is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when OAuth confirm is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel
      .mockReturnValueOnce(false) // deployment
      .mockReturnValueOnce(false) // port
      .mockReturnValueOnce(true); // oauth cancel

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when tool selection returns null", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm.mockResolvedValueOnce(false); // no oauth
    (runToolSelectionFlow as jest.Mock).mockResolvedValueOnce(null);

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should complete standalone setup without OAuth", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm
      .mockResolvedValueOnce(false) // no oauth
      .mockResolvedValueOnce(true); // start now

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(initDockerConfig).toHaveBeenCalled();
    expect(startContainer).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.dockerConfig!.port).toBe(3333);
    expect(result.dockerConfig!.deploymentType).toBe("standalone");
  });

  it("should apply tool config env to Docker config", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("4000");
    mockConfirm
      .mockResolvedValueOnce(false) // no oauth
      .mockResolvedValueOnce(false); // don't start

    await runServerSetupFlow(dockerReadyDiscovery);

    const configArg = (initDockerConfig as jest.Mock).mock.calls[0][0];
    expect(configArg.env.GITLAB_PROFILE).toBe("developer");
  });

  it("should handle OAuth with external database", async () => {
    mockSelect.mockResolvedValueOnce("external-db");
    mockText
      .mockResolvedValueOnce("3333") // port
      .mockResolvedValueOnce("postgresql://user:pass@host:5432/db"); // db url
    mockConfirm
      .mockResolvedValueOnce(true) // enable oauth
      .mockResolvedValueOnce(false); // don't start

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(true);
    const configArg = (initDockerConfig as jest.Mock).mock.calls[0][0];
    expect(configArg.oauthEnabled).toBe(true);
    expect(configArg.databaseUrl).toBe("postgresql://user:pass@host:5432/db");
    expect(configArg.oauthSessionSecret).toBeDefined();
  });

  it("should return cancelled when database URL is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("external-db");
    mockText.mockResolvedValueOnce("3333").mockResolvedValueOnce(Symbol("cancel")); // db url cancel
    mockConfirm.mockResolvedValueOnce(true); // enable oauth
    mockIsCancel
      .mockReturnValueOnce(false) // deployment
      .mockReturnValueOnce(false) // port
      .mockReturnValueOnce(false) // oauth
      .mockReturnValueOnce(true); // db url cancel

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should handle initDockerConfig error", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm.mockResolvedValueOnce(false);
    (initDockerConfig as jest.Mock).mockImplementationOnce(() => {
      throw new Error("Permission denied");
    });

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("should handle container start failure", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true); // start now
    (startContainer as jest.Mock).mockReturnValueOnce({ success: false, error: "Port in use" });

    const result = await runServerSetupFlow(dockerReadyDiscovery);

    expect(result.success).toBe(true); // Setup still successful, container just didn't start
    expect(p.log.error).toHaveBeenCalledWith("Port in use");
  });

  it("should apply advanced envOverrides to Docker config", async () => {
    (runToolSelectionFlow as jest.Mock).mockResolvedValueOnce({
      mode: "advanced",
      envOverrides: { LOG_LEVEL: "debug", GITLAB_READ_ONLY_MODE: "true" },
    });
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm
      .mockResolvedValueOnce(false) // no oauth
      .mockResolvedValueOnce(false); // don't start

    await runServerSetupFlow(dockerReadyDiscovery);

    const configArg = (initDockerConfig as jest.Mock).mock.calls[0][0];
    expect(configArg.env.LOG_LEVEL).toBe("debug");
    expect(configArg.env.GITLAB_READ_ONLY_MODE).toBe("true");
  });

  it("should apply manual categories to Docker config", async () => {
    (runToolSelectionFlow as jest.Mock).mockResolvedValueOnce({
      mode: "manual",
      enabledCategories: ["merge-requests"],
    });
    mockSelect.mockResolvedValueOnce("standalone");
    mockText.mockResolvedValueOnce("3333");
    mockConfirm
      .mockResolvedValueOnce(false) // no oauth
      .mockResolvedValueOnce(false); // don't start

    await runServerSetupFlow(dockerReadyDiscovery);

    expect(applyManualCategories).toHaveBeenCalledWith(["merge-requests"], expect.any(Object));
  });

  it("should validate port number", async () => {
    mockSelect.mockResolvedValueOnce("standalone");
    // Provide valid port after validation would reject invalid
    mockText.mockResolvedValueOnce("3333");
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await runServerSetupFlow(dockerReadyDiscovery);

    // Verify text was called with validate function
    const textCall = (mockText.mock.calls[0] as unknown[])[0] as {
      validate: (v: string) => string | undefined;
    };
    expect(textCall.validate("0")).toBe("Port must be between 1 and 65535");
    expect(textCall.validate("99999")).toBe("Port must be between 1 and 65535");
    expect(textCall.validate("abc")).toBe("Port must be between 1 and 65535");
    expect(textCall.validate("3333")).toBeUndefined();
  });

  it("should validate database URL format", async () => {
    mockSelect.mockResolvedValueOnce("external-db");
    mockText
      .mockResolvedValueOnce("3333")
      .mockResolvedValueOnce("postgresql://user:pass@host:5432/db");
    mockConfirm
      .mockResolvedValueOnce(true) // enable oauth
      .mockResolvedValueOnce(false); // don't start

    await runServerSetupFlow(dockerReadyDiscovery);

    // Find the database URL text call (second call to text)
    const dbTextCall = (mockText.mock.calls[1] as unknown[])[0] as {
      validate: (v: string) => string | undefined;
    };
    expect(dbTextCall.validate("mysql://host/db")).toBe("Must be a valid PostgreSQL URL");
    expect(dbTextCall.validate("")).toBe("Must be a valid PostgreSQL URL");
    expect(dbTextCall.validate("postgresql://host/db")).toBeUndefined();
  });
});
