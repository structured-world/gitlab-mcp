/**
 * Unit tests for configure-existing flow
 */

import * as p from "@clack/prompts";

jest.mock("@clack/prompts", () => ({
  select: jest.fn(),
  multiselect: jest.fn(),
  password: jest.fn(),
  spinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    step: jest.fn(),
  },
  isCancel: jest.fn().mockReturnValue(false),
}));

jest.mock("../../../../../src/cli/install/installers", () => ({
  installToClients: jest.fn().mockReturnValue([{ success: true, client: "cursor" }]),
}));

jest.mock("../../../../../src/cli/install/install-command", () => ({
  buildServerConfigFromEnv: jest.fn().mockReturnValue({
    command: "npx",
    args: ["-y", "@structured-world/gitlab-mcp@latest"],
    env: { GITLAB_TOKEN: "existing-token" },
  }),
}));

jest.mock("../../../../../src/cli/docker/docker-utils", () => ({
  startContainer: jest.fn().mockReturnValue({ success: true }),
  restartContainer: jest.fn().mockReturnValue({ success: true }),
}));

import { runConfigureExistingFlow } from "../../../../../src/cli/setup/flows/configure-existing";
import { DiscoveryResult } from "../../../../../src/cli/setup/types";
import { installToClients } from "../../../../../src/cli/install/installers";
import { buildServerConfigFromEnv } from "../../../../../src/cli/install/install-command";

const mockSelect = p.select as jest.MockedFunction<typeof p.select>;
const mockMultiselect = p.multiselect as jest.MockedFunction<typeof p.multiselect>;
const mockPassword = p.password as jest.MockedFunction<typeof p.password>;
const mockIsCancel = p.isCancel as jest.MockedFunction<typeof p.isCancel>;

const discoveryWithUnconfigured: DiscoveryResult = {
  clients: {
    detected: [
      { client: "cursor", detected: true, method: "config-file" },
      { client: "claude-code", detected: true, method: "cli-command" },
    ],
    configured: [
      { client: "cursor", detected: true, method: "config-file", alreadyConfigured: true },
    ],
    unconfigured: [{ client: "claude-code", detected: true, method: "cli-command" }],
  },
  docker: { dockerInstalled: false, dockerRunning: false, composeInstalled: false, instances: [] },
  summary: {
    hasExistingSetup: true,
    clientCount: 2,
    configuredCount: 1,
    dockerRunning: false,
    containerExists: false,
  },
};

const discoveryWithDocker: DiscoveryResult = {
  clients: { detected: [], configured: [], unconfigured: [] },
  docker: {
    dockerInstalled: true,
    dockerRunning: true,
    composeInstalled: true,
    container: {
      id: "abc123",
      name: "gitlab-mcp",
      image: "test",
      status: "running",
      ports: [],
      created: "",
    },
    instances: [],
  },
  summary: {
    hasExistingSetup: true,
    clientCount: 0,
    configuredCount: 0,
    dockerRunning: true,
    containerExists: true,
  },
};

describe("flows/configure-existing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
  });

  it("should return cancelled when action is cancelled", async () => {
    mockIsCancel.mockReturnValueOnce(true);
    mockSelect.mockResolvedValueOnce(Symbol("cancel"));

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when cancel action is selected", async () => {
    mockSelect.mockResolvedValueOnce("cancel");

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should add gitlab-mcp to unconfigured clients", async () => {
    mockSelect.mockResolvedValueOnce("add-clients");
    mockMultiselect.mockResolvedValueOnce(["claude-code"]);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(installToClients).toHaveBeenCalledWith(["claude-code"], expect.any(Object), false);
    expect(result.success).toBe(true);
  });

  it("should prompt for token when env has no token", async () => {
    (buildServerConfigFromEnv as jest.Mock).mockReturnValueOnce({
      command: "npx",
      args: [],
      env: { GITLAB_TOKEN: "" },
    });
    mockSelect.mockResolvedValueOnce("add-clients");
    mockMultiselect.mockResolvedValueOnce(["claude-code"]);
    mockPassword.mockResolvedValueOnce("new-token");

    await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(mockPassword).toHaveBeenCalled();
  });

  it("should return cancelled when token input is cancelled during add", async () => {
    (buildServerConfigFromEnv as jest.Mock).mockReturnValueOnce({
      command: "npx",
      args: [],
      env: { GITLAB_TOKEN: "" },
    });
    mockSelect.mockResolvedValueOnce("add-clients");
    mockMultiselect.mockResolvedValueOnce(["claude-code"]);
    mockPassword.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel
      .mockReturnValueOnce(false) // action
      .mockReturnValueOnce(false) // multiselect
      .mockReturnValueOnce(true); // password cancel

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when client selection is cancelled during add", async () => {
    mockSelect.mockResolvedValueOnce("add-clients");
    mockMultiselect.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should update existing client configurations", async () => {
    mockSelect.mockResolvedValueOnce("update-clients");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(installToClients).toHaveBeenCalledWith(
      ["cursor"],
      expect.any(Object),
      true // overwrite = true for updates
    );
    expect(result.success).toBe(true);
  });

  it("should report update failures", async () => {
    mockSelect.mockResolvedValueOnce("update-clients");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);
    (installToClients as jest.Mock).mockReturnValueOnce([
      { success: false, client: "cursor", error: "Permission denied" },
    ]);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(p.log.error).toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to update");
  });

  it("should return cancelled when client selection is cancelled during update", async () => {
    mockSelect.mockResolvedValueOnce("update-clients");
    mockMultiselect.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should prompt for token when env has no token during update", async () => {
    (buildServerConfigFromEnv as jest.Mock).mockReturnValueOnce({
      command: "npx",
      args: [],
      env: { GITLAB_TOKEN: "" },
    });
    mockSelect.mockResolvedValueOnce("update-clients");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);
    mockPassword.mockResolvedValueOnce("new-token");

    await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(mockPassword).toHaveBeenCalled();
  });

  it("should return cancelled when token cancelled during update", async () => {
    (buildServerConfigFromEnv as jest.Mock).mockReturnValueOnce({
      command: "npx",
      args: [],
      env: { GITLAB_TOKEN: "" },
    });
    mockSelect.mockResolvedValueOnce("update-clients");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);
    mockPassword.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel
      .mockReturnValueOnce(false) // action
      .mockReturnValueOnce(false) // multiselect
      .mockReturnValueOnce(true); // password cancel

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(result.success).toBe(false);
  });

  it("should restart Docker container", async () => {
    mockSelect.mockResolvedValueOnce("restart-docker");

    const result = await runConfigureExistingFlow(discoveryWithDocker);

    const { restartContainer } = require("../../../../../src/cli/docker/docker-utils");
    expect(restartContainer).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should start stopped Docker container", async () => {
    const stoppedDocker: DiscoveryResult = {
      ...discoveryWithDocker,
      docker: {
        ...discoveryWithDocker.docker,
        container: { ...discoveryWithDocker.docker.container!, status: "stopped" },
      },
    };
    mockSelect.mockResolvedValueOnce("start-docker");

    const result = await runConfigureExistingFlow(stoppedDocker);

    const { startContainer } = require("../../../../../src/cli/docker/docker-utils");
    expect(startContainer).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should handle Docker start failure", async () => {
    const { restartContainer } = require("../../../../../src/cli/docker/docker-utils");
    restartContainer.mockReturnValueOnce({ success: false, error: "Container not found" });
    mockSelect.mockResolvedValueOnce("restart-docker");

    const result = await runConfigureExistingFlow(discoveryWithDocker);

    expect(p.log.error).toHaveBeenCalledWith("Container not found");
    expect(result.success).toBe(false);
  });

  it("should report add-clients failures", async () => {
    mockSelect.mockResolvedValueOnce("add-clients");
    mockMultiselect.mockResolvedValueOnce(["claude-code"]);
    (installToClients as jest.Mock).mockReturnValueOnce([
      { success: false, client: "claude-code", error: "Write error" },
    ]);

    const result = await runConfigureExistingFlow(discoveryWithUnconfigured);

    expect(p.log.error).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
