const accessAllExports = (mod: Record<string, unknown>): void => {
  const keys = Object.keys(mod);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    expect(mod[key]).toBeDefined();
    void mod[key];
  }
};

describe("barrel exports", () => {
  it("exports oauth module", () => {
    const mod = require("../../../src/oauth");
    accessAllExports(mod);
  });

  it("exports oauth endpoints", () => {
    const mod = require("../../../src/oauth/endpoints");
    accessAllExports(mod);
  });

  it("exports logging module", () => {
    const mod = require("../../../src/logging");
    accessAllExports(mod);
  });

  it("exports middleware module", () => {
    const mod = require("../../../src/middleware");
    accessAllExports(mod);
  });

  it("exports cli setup module", () => {
    const mod = require("../../../src/cli/setup");
    accessAllExports(mod);
  });

  it("exports cli utils module", () => {
    const mod = require("../../../src/cli/utils");
    accessAllExports(mod);
  });

  it("exports entities index modules", () => {
    accessAllExports(require("../../../src/entities/releases"));
    accessAllExports(require("../../../src/entities/snippets"));
    accessAllExports(require("../../../src/entities/members"));
    accessAllExports(require("../../../src/entities/refs"));
    accessAllExports(require("../../../src/entities/search"));
  });
});
