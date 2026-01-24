/**
 * Unit tests for description-utils.ts
 * Tests dynamic resolution of "Related:" cross-references in tool descriptions
 */

import { resolveRelatedReferences } from "../../../src/utils/description-utils";

describe("resolveRelatedReferences", () => {
  it("returns description unchanged when no Related section", () => {
    const desc = "Find projects. Actions: search, list, get.";
    expect(resolveRelatedReferences(desc, new Set(["manage_project"]))).toBe(desc);
  });

  it("keeps Related when referenced tool is available", () => {
    const desc = "Find projects. Related: manage_project to create.";
    const result = resolveRelatedReferences(desc, new Set(["manage_project"]));
    expect(result).toContain("Related: manage_project");
  });

  it("strips Related when referenced tool is unavailable", () => {
    const desc = "Find projects. Related: manage_project to create.";
    const result = resolveRelatedReferences(desc, new Set(["browse_labels"]));
    expect(result).toBe("Find projects.");
  });

  it("keeps only available tools from comma-separated list", () => {
    const desc =
      "Read discussions. Related: manage_mr_discussion to comment, manage_draft_notes to create.";
    const result = resolveRelatedReferences(desc, new Set(["manage_mr_discussion"]));
    expect(result).toBe("Read discussions. Related: manage_mr_discussion to comment.");
    expect(result).not.toContain("manage_draft_notes");
  });

  it("handles all tools unavailable in multi-reference", () => {
    const desc = "Monitor CI/CD. Related: manage_pipeline to retry, manage_pipeline_job for jobs.";
    const result = resolveRelatedReferences(desc, new Set(["browse_labels"]));
    expect(result).toBe("Monitor CI/CD.");
  });

  it("handles browse_ references correctly", () => {
    const desc = "Create refs. Related: browse_refs for inspection.";
    const result = resolveRelatedReferences(desc, new Set(["browse_refs"]));
    expect(result).toContain("browse_refs");
  });

  it("preserves base description with actions when Related is stripped", () => {
    const desc =
      "List and inspect labels. Actions: list, get. Related: manage_label to create/update/delete.";
    const result = resolveRelatedReferences(desc, new Set(["browse_labels"]));
    expect(result).toBe("List and inspect labels. Actions: list, get.");
  });

  it("keeps all references when all tools are available", () => {
    const desc = "Monitor CI/CD. Related: manage_pipeline to retry, manage_pipeline_job for jobs.";
    const result = resolveRelatedReferences(
      desc,
      new Set(["manage_pipeline", "manage_pipeline_job"])
    );
    expect(result).toBe(
      "Monitor CI/CD. Related: manage_pipeline to retry, manage_pipeline_job for jobs."
    );
  });

  it("handles description without trailing period on Related section", () => {
    const desc = "Find items. Related: manage_work_item to create";
    const result = resolveRelatedReferences(desc, new Set(["manage_work_item"]));
    expect(result).toContain("Related: manage_work_item to create.");
  });

  it("does not match non-tool references in Related section", () => {
    // If Related contains something that doesn't start with browse_/manage_, it's filtered
    const desc = "Find items. Related: some_other_tool for testing.";
    const result = resolveRelatedReferences(desc, new Set(["some_other_tool"]));
    expect(result).toBe("Find items.");
  });
});
