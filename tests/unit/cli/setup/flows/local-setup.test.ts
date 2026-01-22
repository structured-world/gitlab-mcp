/**
 * Unit tests for local-setup flow
 */

import * as p from "@clack/prompts";

jest.mock("@clack/prompts", () => ({
  select: jest.fn(),
  multiselect: jest.fn(),
  confirm: jest.fn(),
  text: jest.fn(),
  password: jest.fn(),
  note: jest.fn(),
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

jest.mock("../../../../../src/cli/init/connection", () => ({
  testConnection: jest
    .fn()
    .mockResolvedValue({ success: true, username: "testuser", gitlabVersion: "16.0" }),
  validateGitLabUrl: jest.fn().mockReturnValue({ valid: true }),
  getPatCreationUrl: jest
    .fn()
    .mockReturnValue("https://gitlab.com/-/user_settings/personal_access_tokens"),
}));

jest.mock("../../../../../src/cli/init/browser", () => ({
  openUrl: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../../../../src/cli/install/installers", () => ({
  installToClients: jest
    .fn()
    .mockReturnValue([{ success: true, client: "cursor", configPath: "/home/.cursor/mcp.json" }]),
}));

jest.mock("../../../../../src/cli/setup/flows/tool-selection", () => ({
  runToolSelectionFlow: jest
    .fn()
    .mockResolvedValue({ mode: "preset", preset: "developer", enabledCategories: ["core"] }),
  applyManualCategories: jest.fn(),
}));

import { runLocalSetupFlow } from "../../../../../src/cli/setup/flows/local-setup";
import { DiscoveryResult } from "../../../../../src/cli/setup/types";
import { testConnection } from "../../../../../src/cli/init/connection";
import { installToClients } from "../../../../../src/cli/install/installers";
import { runToolSelectionFlow } from "../../../../../src/cli/setup/flows/tool-selection";

const mockSelect = p.select as jest.MockedFunction<typeof p.select>;
const mockConfirm = p.confirm as jest.MockedFunction<typeof p.confirm>;
const mockPassword = p.password as jest.MockedFunction<typeof p.password>;
const mockText = p.text as jest.MockedFunction<typeof p.text>;
const mockMultiselect = p.multiselect as jest.MockedFunction<typeof p.multiselect>;
const mockIsCancel = p.isCancel as jest.MockedFunction<typeof p.isCancel>;

const emptyDiscovery: DiscoveryResult = {
  clients: { detected: [], configured: [], unconfigured: [] },
  docker: { dockerInstalled: false, dockerRunning: false, composeInstalled: false, instances: [] },
  summary: {
    hasExistingSetup: false,
    clientCount: 0,
    configuredCount: 0,
    dockerRunning: false,
    containerExists: false,
  },
};

const discoveryWithClients: DiscoveryResult = {
  ...emptyDiscovery,
  clients: {
    detected: [{ client: "cursor", detected: true, method: "config-file" }],
    configured: [],
    unconfigured: [{ client: "cursor", detected: true, method: "config-file" }],
  },
};

describe("flows/local-setup", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Restore clack mocks that resetAllMocks clears
    mockIsCancel.mockReturnValue(false);
    (p.spinner as jest.Mock).mockReturnValue({
      start: jest.fn(),
      stop: jest.fn(),
    });
    // Restore module mocks
    (installToClients as jest.Mock).mockReturnValue([
      { success: true, client: "cursor", configPath: "/home/.cursor/mcp.json" },
    ]);
    (testConnection as jest.Mock).mockResolvedValue({
      success: true,
      username: "testuser",
      gitlabVersion: "16.0",
    });
    (runToolSelectionFlow as jest.Mock).mockResolvedValue({
      mode: "preset",
      preset: "developer",
      enabledCategories: ["core"],
    });
  });

  it("should return cancelled when instance type is cancelled", async () => {
    mockIsCancel.mockReturnValueOnce(true);
    mockSelect.mockResolvedValueOnce(Symbol("cancel"));

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should use gitlab.com for SaaS selection", async () => {
    mockSelect.mockResolvedValueOnce("saas"); // instance type
    mockConfirm.mockResolvedValueOnce(true); // has token
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce([]); // no clients selected

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(true);
  });

  it("should prompt for URL when self-hosted selected", async () => {
    mockSelect.mockResolvedValueOnce("self-hosted"); // instance type
    mockText.mockResolvedValueOnce("https://gitlab.example.com"); // URL
    mockConfirm.mockResolvedValueOnce(true); // has token
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce([]); // no clients

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(true);
  });

  it("should return cancelled when URL input is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("self-hosted");
    mockText.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return cancelled when has-token confirm is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should show PAT creation note and open browser when user has no token", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm
      .mockResolvedValueOnce(false) // no token
      .mockResolvedValueOnce(true); // open browser
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce([]); // no clients

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(p.note).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("should return cancelled when token input is cancelled", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true); // has token
    mockPassword.mockResolvedValueOnce(Symbol("cancel"));
    mockIsCancel
      .mockReturnValueOnce(false) // instance
      .mockReturnValueOnce(false) // confirm
      .mockReturnValueOnce(true); // password cancel

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should return error when connection fails", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    (testConnection as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: "401 Unauthorized",
    });

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("401 Unauthorized");
  });

  it("should return cancelled when tool selection returns null", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    (runToolSelectionFlow as jest.Mock).mockResolvedValueOnce(null);

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cancelled");
  });

  it("should install to selected clients", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce(["cursor"]); // select client

    const result = await runLocalSetupFlow(discoveryWithClients);

    expect(installToClients).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.configuredClients).toContain("cursor");
  });

  it("should show config when no clients detected", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");

    const result = await runLocalSetupFlow(emptyDiscovery);

    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("No MCP clients detected"));
    expect(result.success).toBe(true);
  });

  it("should report failed client installations", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);
    (installToClients as jest.Mock).mockReturnValueOnce([
      { success: false, client: "cursor", error: "Permission denied" },
    ]);

    const result = await runLocalSetupFlow(discoveryWithClients);

    expect(p.log.error).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("should set GITLAB_API_URL in generated config", async () => {
    (installToClients as jest.Mock).mockReturnValue([
      { success: true, client: "cursor", configPath: "/home/.cursor/mcp.json" },
    ]);
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);

    await runLocalSetupFlow(discoveryWithClients);

    const installCall = (installToClients as jest.Mock).mock.calls[0];
    const serverConfig = installCall[1];
    expect(serverConfig.env.GITLAB_API_URL).toBe("https://gitlab.com");
    expect(serverConfig.env.GITLAB_TOKEN).toBe("glpat-xxxxxxxxxxxxxxxxxxxx");
  });

  it("should set GITLAB_PROFILE for preset mode", async () => {
    (installToClients as jest.Mock).mockReturnValue([
      { success: true, client: "cursor", configPath: "/home/.cursor/mcp.json" },
    ]);
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce(["cursor"]);

    await runLocalSetupFlow(discoveryWithClients);

    const installCall = (installToClients as jest.Mock).mock.calls[0];
    const serverConfig = installCall[1];
    expect(serverConfig.env.GITLAB_PROFILE).toBe("developer");
  });

  it("should show config when client selection returns empty", async () => {
    mockSelect.mockResolvedValueOnce("saas");
    mockConfirm.mockResolvedValueOnce(true);
    mockPassword.mockResolvedValueOnce("glpat-xxxxxxxxxxxxxxxxxxxx");
    mockMultiselect.mockResolvedValueOnce([]); // empty selection

    const result = await runLocalSetupFlow(discoveryWithClients);

    // When no clients selected, shows config instead
    expect(result.success).toBe(true);
    expect(p.note).toHaveBeenCalled();
  });
});
