/**
 * Unit tests for tool-selection flow
 */

import * as p from "@clack/prompts";

jest.mock("@clack/prompts", () => ({
  select: jest.fn(),
  multiselect: jest.fn(),
  confirm: jest.fn(),
  text: jest.fn(),
  log: {
    info: jest.fn(),
    step: jest.fn(),
  },
  isCancel: jest.fn().mockReturnValue(false),
}));

import {
  runToolSelectionFlow,
  applyManualCategories,
} from "../../../../../src/cli/setup/flows/tool-selection";

const mockSelect = p.select as jest.MockedFunction<typeof p.select>;
const mockMultiselect = p.multiselect as jest.MockedFunction<typeof p.multiselect>;
const mockConfirm = p.confirm as jest.MockedFunction<typeof p.confirm>;
const mockText = p.text as jest.MockedFunction<typeof p.text>;
const mockIsCancel = p.isCancel as jest.MockedFunction<typeof p.isCancel>;

describe("flows/tool-selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCancel.mockReturnValue(false);
  });

  describe("runToolSelectionFlow", () => {
    it("should return null when mode selection is cancelled", async () => {
      mockIsCancel.mockReturnValueOnce(true);
      mockSelect.mockResolvedValue("preset");

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should run preset selection flow", async () => {
      mockSelect
        .mockResolvedValueOnce("preset") // mode selection
        .mockResolvedValueOnce("developer"); // preset selection

      const result = await runToolSelectionFlow();

      expect(result).toBeDefined();
      expect(result!.mode).toBe("preset");
      expect(result!.preset).toBe("developer");
      expect(result!.enabledCategories).toBeDefined();
    });

    it("should return null when preset selection is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("preset");
      // Second call returns cancel symbol
      mockSelect.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should run manual selection flow", async () => {
      mockSelect.mockResolvedValueOnce("manual");
      mockMultiselect.mockResolvedValueOnce(["core", "merge-requests", "work-items"]);

      const result = await runToolSelectionFlow();

      expect(result).toBeDefined();
      expect(result!.mode).toBe("manual");
      expect(result!.enabledCategories).toEqual(["core", "merge-requests", "work-items"]);
    });

    it("should return null when manual selection is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("manual");
      mockMultiselect.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should run advanced settings flow with basic options", async () => {
      mockSelect
        .mockResolvedValueOnce("advanced") // mode
        .mockResolvedValueOnce("info"); // log level
      mockMultiselect.mockResolvedValueOnce(["USE_MRS", "USE_PIPELINE"]); // features
      mockConfirm
        .mockResolvedValueOnce(false) // read-only
        .mockResolvedValueOnce(false); // scope restrictions

      const result = await runToolSelectionFlow();

      expect(result).toBeDefined();
      expect(result!.mode).toBe("advanced");
      expect(result!.envOverrides).toBeDefined();
      expect(result!.envOverrides!.USE_MRS).toBe("true");
      expect(result!.envOverrides!.USE_PIPELINE).toBe("true");
      expect(result!.envOverrides!.USE_WORKITEMS).toBe("false");
    });

    it("should set read-only mode when enabled", async () => {
      mockSelect.mockResolvedValueOnce("advanced").mockResolvedValueOnce("info");
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm
        .mockResolvedValueOnce(true) // read-only = yes
        .mockResolvedValueOnce(false); // no scope

      const result = await runToolSelectionFlow();

      expect(result!.envOverrides!.GITLAB_READ_ONLY_MODE).toBe("true");
    });

    it("should configure project scope restriction", async () => {
      mockSelect
        .mockResolvedValueOnce("advanced")
        .mockResolvedValueOnce("project") // scope type
        .mockResolvedValueOnce("info"); // log level
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm
        .mockResolvedValueOnce(false) // no read-only
        .mockResolvedValueOnce(true); // yes scope
      mockText.mockResolvedValueOnce("my-group/my-project");

      const result = await runToolSelectionFlow();

      expect(result!.envOverrides!.GITLAB_PROJECT_ID).toBe("my-group/my-project");
    });

    it("should configure project allowlist scope restriction", async () => {
      mockSelect
        .mockResolvedValueOnce("advanced")
        .mockResolvedValueOnce("allowlist") // scope type
        .mockResolvedValueOnce("debug"); // log level
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true); // yes scope
      mockText.mockResolvedValueOnce("proj1,proj2");

      const result = await runToolSelectionFlow();

      expect(result!.envOverrides!.GITLAB_ALLOWED_PROJECT_IDS).toBe("proj1,proj2");
      expect(result!.envOverrides!.LOG_LEVEL).toBe("debug");
    });

    it("should not set LOG_LEVEL for default info", async () => {
      mockSelect.mockResolvedValueOnce("advanced").mockResolvedValueOnce("info");
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      const result = await runToolSelectionFlow();

      expect(result!.envOverrides!.LOG_LEVEL).toBeUndefined();
    });

    it("should return null when feature flags selection is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced");
      mockMultiselect.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should return null when read-only confirm is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced");
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel
        .mockReturnValueOnce(false) // mode
        .mockReturnValueOnce(false) // features
        .mockReturnValueOnce(true); // read-only cancel

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should return null when scope confirm is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced");
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm
        .mockResolvedValueOnce(false) // read-only
        .mockResolvedValueOnce(Symbol("cancel")); // scope cancel
      mockIsCancel
        .mockReturnValueOnce(false) // mode
        .mockReturnValueOnce(false) // features
        .mockReturnValueOnce(false) // read-only
        .mockReturnValueOnce(true); // scope cancel

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should return null when scope type selection is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced").mockResolvedValueOnce(Symbol("cancel")); // scope type cancel
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm
        .mockResolvedValueOnce(false) // read-only
        .mockResolvedValueOnce(true); // yes scope
      mockIsCancel
        .mockReturnValueOnce(false) // mode
        .mockReturnValueOnce(false) // features
        .mockReturnValueOnce(false) // read-only
        .mockReturnValueOnce(false) // scope confirm
        .mockReturnValueOnce(true); // scope type cancel

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should return null when project text is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced").mockResolvedValueOnce("project");
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      mockText.mockResolvedValueOnce(Symbol("cancel"));
      mockIsCancel
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true); // text cancel

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });

    it("should return null when log level is cancelled", async () => {
      mockSelect.mockResolvedValueOnce("advanced").mockResolvedValueOnce(Symbol("cancel")); // log level cancel
      mockMultiselect.mockResolvedValueOnce(["USE_MRS"]);
      mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
      mockIsCancel
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true); // log level cancel

      const result = await runToolSelectionFlow();
      expect(result).toBeNull();
    });
  });

  describe("applyManualCategories", () => {
    it("should disable unselected categories", () => {
      const env: Record<string, string> = {};
      applyManualCategories(["merge-requests", "pipelines"], env);

      expect(env.USE_MRS).toBeUndefined(); // selected, not set to false
      expect(env.USE_PIPELINE).toBeUndefined(); // selected
      expect(env.USE_WORKITEMS).toBe("false"); // not selected
      expect(env.USE_GITLAB_WIKI).toBe("false"); // not selected
      expect(env.USE_VARIABLES).toBe("false"); // not selected
    });

    it("should not set any flag to false when all are selected", () => {
      const env: Record<string, string> = {};
      const allCategories = [
        "merge-requests",
        "work-items",
        "pipelines",
        "files",
        "wiki",
        "snippets",
        "releases",
        "refs",
        "labels",
        "milestones",
        "members",
        "search",
        "variables",
        "webhooks",
        "integrations",
      ];
      applyManualCategories(allCategories, env);

      for (const value of Object.values(env)) {
        expect(value).not.toBe("false");
      }
    });

    it("should set all to false when empty selection", () => {
      const env: Record<string, string> = {};
      applyManualCategories([], env);

      expect(env.USE_MRS).toBe("false");
      expect(env.USE_PIPELINE).toBe("false");
      expect(env.USE_WORKITEMS).toBe("false");
      expect(env.USE_FILES).toBe("false");
      expect(env.USE_GITLAB_WIKI).toBe("false");
    });
  });
});
