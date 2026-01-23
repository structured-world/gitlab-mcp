/**
 * Unit tests for the unified setup wizard
 */

import * as p from "@clack/prompts";

// Mock @clack/prompts
jest.mock("@clack/prompts", () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  cancel: jest.fn(),
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
  select: jest.fn(),
  confirm: jest.fn(),
  text: jest.fn(),
  password: jest.fn(),
  multiselect: jest.fn(),
  note: jest.fn(),
  isCancel: jest.fn().mockReturnValue(false),
}));

// Mock discovery
jest.mock("../../../../src/cli/setup/discovery", () => ({
  runDiscovery: jest.fn().mockReturnValue({
    clients: { detected: [], configured: [], unconfigured: [] },
    docker: {
      dockerInstalled: false,
      dockerRunning: false,
      composeInstalled: false,
      instances: [],
    },
    summary: {
      hasExistingSetup: false,
      clientCount: 0,
      configuredCount: 0,
      dockerRunning: false,
      containerExists: false,
    },
  }),
  formatDiscoverySummary: jest.fn().mockReturnValue("No MCP clients detected"),
}));

// Mock flows
jest.mock("../../../../src/cli/setup/flows/local-setup", () => ({
  runLocalSetupFlow: jest.fn().mockResolvedValue({ success: true, mode: "local" }),
}));

jest.mock("../../../../src/cli/setup/flows/server-setup", () => ({
  runServerSetupFlow: jest.fn().mockResolvedValue({ success: true, mode: "server" }),
}));

jest.mock("../../../../src/cli/setup/flows/configure-existing", () => ({
  runConfigureExistingFlow: jest
    .fn()
    .mockResolvedValue({ success: true, mode: "configure-existing" }),
}));

import { runSetupWizard } from "../../../../src/cli/setup/wizard";
import { runDiscovery } from "../../../../src/cli/setup/discovery";
import { runLocalSetupFlow } from "../../../../src/cli/setup/flows/local-setup";
import { runServerSetupFlow } from "../../../../src/cli/setup/flows/server-setup";
import { runConfigureExistingFlow } from "../../../../src/cli/setup/flows/configure-existing";

const mockSelect = p.select as jest.MockedFunction<typeof p.select>;
const mockRunDiscovery = runDiscovery as jest.MockedFunction<typeof runDiscovery>;

describe("setup/wizard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no existing setup, user selects "local"
    mockSelect.mockResolvedValue("local");
  });

  describe("runSetupWizard", () => {
    it("should run discovery phase and display summary", async () => {
      await runSetupWizard({ mode: "local" });

      expect(runDiscovery).toHaveBeenCalled();
      expect(p.intro).toHaveBeenCalledWith("GitLab MCP Setup Wizard");
    });

    it("should run local setup flow when mode is local", async () => {
      await runSetupWizard({ mode: "local" });

      expect(runLocalSetupFlow).toHaveBeenCalled();
      expect(runServerSetupFlow).not.toHaveBeenCalled();
      expect(runConfigureExistingFlow).not.toHaveBeenCalled();
    });

    it("should run server setup flow when mode is server", async () => {
      await runSetupWizard({ mode: "server" });

      expect(runServerSetupFlow).toHaveBeenCalled();
      expect(runLocalSetupFlow).not.toHaveBeenCalled();
    });

    it("should run configure-existing flow when mode is configure-existing", async () => {
      await runSetupWizard({ mode: "configure-existing" });

      expect(runConfigureExistingFlow).toHaveBeenCalled();
      expect(runLocalSetupFlow).not.toHaveBeenCalled();
    });

    it("should present mode selection when no mode specified", async () => {
      mockSelect.mockResolvedValue("local");

      await runSetupWizard();

      // Select should be called for mode selection
      expect(mockSelect).toHaveBeenCalled();
      expect(runLocalSetupFlow).toHaveBeenCalled();
    });

    it("should show configure-existing option when existing setup found", async () => {
      mockRunDiscovery.mockReturnValue({
        clients: {
          detected: [
            { client: "cursor", detected: true, method: "config-file", alreadyConfigured: true },
          ],
          configured: [
            { client: "cursor", detected: true, method: "config-file", alreadyConfigured: true },
          ],
          unconfigured: [],
        },
        docker: {
          dockerInstalled: false,
          dockerRunning: false,
          composeInstalled: false,
          instances: [],
        },
        summary: {
          hasExistingSetup: true,
          clientCount: 1,
          configuredCount: 1,
          dockerRunning: false,
          containerExists: false,
        },
      });

      mockSelect.mockResolvedValue("configure-existing");

      await runSetupWizard();

      // Verify select was called with configure-existing option
      const selectCall = mockSelect.mock.calls[0][0] as { options: { value: string }[] };
      const hasConfigureOption = selectCall.options.some(
        (o: { value: string }) => o.value === "configure-existing"
      );
      expect(hasConfigureOption).toBe(true);
    });

    it("should display success message on completion", async () => {
      (runLocalSetupFlow as jest.Mock).mockResolvedValue({
        success: true,
        mode: "local",
        configuredClients: ["cursor"],
      });

      await runSetupWizard({ mode: "local" });

      expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("Setup complete!"));
    });

    it("should display failure message on error", async () => {
      (runLocalSetupFlow as jest.Mock).mockResolvedValue({
        success: false,
        mode: "local",
        error: "Connection failed",
      });

      await runSetupWizard({ mode: "local" });

      expect(p.outro).toHaveBeenCalledWith(expect.stringContaining("Setup failed"));
    });

    it("should display cancelled message when user cancels", async () => {
      (runLocalSetupFlow as jest.Mock).mockResolvedValue({
        success: false,
        mode: "local",
        error: "Cancelled",
      });

      await runSetupWizard({ mode: "local" });

      expect(p.outro).toHaveBeenCalledWith("Setup cancelled.");
    });
  });
});
