/**
 * Tests for cli/instances module exports
 */

describe("cli/instances module", () => {
  it("should export runInstanceCommand", async () => {
    const { runInstanceCommand } = await import("../../../../src/cli/instances/index.js");
    expect(runInstanceCommand).toBeDefined();
    expect(typeof runInstanceCommand).toBe("function");
  });

  it("should export parseInstanceSubcommand", async () => {
    const { parseInstanceSubcommand } = await import("../../../../src/cli/instances/index.js");
    expect(parseInstanceSubcommand).toBeDefined();
    expect(typeof parseInstanceSubcommand).toBe("function");
  });
});
