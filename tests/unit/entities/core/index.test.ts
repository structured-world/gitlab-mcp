import * as coreIndex from "../../../../src/entities/core/index";

describe("Core Entity Index", () => {
  it("should export shared schemas", () => {
    expect(coreIndex).toBeDefined();

    // Check that shared exports exist
    expect(coreIndex.PaginationOptionsSchema).toBeDefined();
  });

  it("should export read-only schemas", () => {
    // Consolidated CQRS schemas
    expect(coreIndex.BrowseProjectsSchema).toBeDefined();
    expect(coreIndex.BrowseNamespacesSchema).toBeDefined();
    expect(coreIndex.BrowseCommitsSchema).toBeDefined();
    expect(coreIndex.BrowseEventsSchema).toBeDefined();
    expect(coreIndex.BrowseUsersSchema).toBeDefined();
    expect(coreIndex.BrowseTodosSchema).toBeDefined();
  });

  it("should export write schemas", () => {
    expect(coreIndex.ManageProjectSchema).toBeDefined();
    expect(coreIndex.ManageNamespaceSchema).toBeDefined();
    expect(coreIndex.ManageTodosSchema).toBeDefined();
  });

  it("should export registry functions", () => {
    expect(coreIndex.getCoreToolDefinitions).toBeDefined();
    expect(coreIndex.getFilteredCoreTools).toBeDefined();
    expect(coreIndex.getCoreReadOnlyToolNames).toBeDefined();
  });

  it("should export the tool registry", () => {
    expect(coreIndex.coreToolRegistry).toBeDefined();
    expect(coreIndex.coreToolRegistry instanceof Map).toBe(true);
  });
});
