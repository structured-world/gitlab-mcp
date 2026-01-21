/**
 * Tests for scope enforcer
 */

import {
  ScopeEnforcer,
  ScopeViolationError,
  extractProjectsFromArgs,
  extractGroupsFromArgs,
  enforceArgsScope,
} from "../../../src/profiles/scope-enforcer";
import { ProjectPreset } from "../../../src/profiles/types";

describe("ScopeEnforcer", () => {
  describe("single project scope", () => {
    it("should allow exact project match", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      expect(enforcer.isAllowed("myteam/backend")).toBe(true);
    });

    it("should allow case-insensitive match", () => {
      const enforcer = new ScopeEnforcer({ project: "MyTeam/Backend" });

      expect(enforcer.isAllowed("myteam/backend")).toBe(true);
      expect(enforcer.isAllowed("MYTEAM/BACKEND")).toBe(true);
    });

    it("should deny different project", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      expect(enforcer.isAllowed("myteam/frontend")).toBe(false);
      expect(enforcer.isAllowed("other/project")).toBe(false);
    });

    it("should handle leading/trailing slashes", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      expect(enforcer.isAllowed("/myteam/backend/")).toBe(true);
      expect(enforcer.isAllowed("  myteam/backend  ")).toBe(true);
    });
  });

  describe("namespace scope", () => {
    it("should allow projects in namespace", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam" });

      expect(enforcer.isAllowed("myteam/backend")).toBe(true);
      expect(enforcer.isAllowed("myteam/frontend")).toBe(true);
      expect(enforcer.isAllowed("myteam/shared-libs")).toBe(true);
    });

    it("should allow projects in nested subgroups", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam" });

      expect(enforcer.isAllowed("myteam/subgroup/project")).toBe(true);
      expect(enforcer.isAllowed("myteam/deep/nested/project")).toBe(true);
    });

    it("should allow subgroup namespace scope", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam/subgroup" });

      expect(enforcer.isAllowed("myteam/subgroup/project")).toBe(true);
      expect(enforcer.isAllowed("myteam/subgroup/other")).toBe(true);
      // Should NOT allow sibling subgroup
      expect(enforcer.isAllowed("myteam/other-subgroup/project")).toBe(false);
    });

    it("should deny projects outside namespace", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam" });

      expect(enforcer.isAllowed("other-team/project")).toBe(false);
      expect(enforcer.isAllowed("my/team/project")).toBe(false);
    });

    it("should deny partial namespace match", () => {
      const enforcer = new ScopeEnforcer({ namespace: "team" });

      // "myteam" should NOT match namespace "team"
      expect(enforcer.isAllowed("myteam/project")).toBe(false);
    });
  });

  describe("projects list scope", () => {
    it("should allow projects in list", () => {
      const enforcer = new ScopeEnforcer({
        projects: ["team/project1", "team/project2", "other/project3"],
      });

      expect(enforcer.isAllowed("team/project1")).toBe(true);
      expect(enforcer.isAllowed("team/project2")).toBe(true);
      expect(enforcer.isAllowed("other/project3")).toBe(true);
    });

    it("should deny projects not in list", () => {
      const enforcer = new ScopeEnforcer({
        projects: ["team/project1", "team/project2"],
      });

      expect(enforcer.isAllowed("team/project3")).toBe(false);
      expect(enforcer.isAllowed("other/project")).toBe(false);
    });
  });

  describe("combined scope", () => {
    it("should allow project from single project OR namespace", () => {
      const enforcer = new ScopeEnforcer({
        project: "special/project",
        namespace: "myteam",
      });

      expect(enforcer.isAllowed("special/project")).toBe(true);
      expect(enforcer.isAllowed("myteam/any-project")).toBe(true);
      expect(enforcer.isAllowed("other/project")).toBe(false);
    });
  });

  describe("single group scope", () => {
    it("should allow exact group match via isGroupAllowed", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });

      expect(enforcer.isGroupAllowed("myteam")).toBe(true);
    });

    it("should allow case-insensitive group match", () => {
      const enforcer = new ScopeEnforcer({ group: "MyTeam" });

      expect(enforcer.isGroupAllowed("myteam")).toBe(true);
      expect(enforcer.isGroupAllowed("MYTEAM")).toBe(true);
    });

    it("should deny different group", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });

      expect(enforcer.isGroupAllowed("other-team")).toBe(false);
      expect(enforcer.isGroupAllowed("other/nested")).toBe(false);
    });

    it("should allow subgroups when includeSubgroups is true", () => {
      const enforcer = new ScopeEnforcer({
        group: "myteam",
        includeSubgroups: true,
      });

      expect(enforcer.isGroupAllowed("myteam")).toBe(true);
      expect(enforcer.isGroupAllowed("myteam/subgroup")).toBe(true);
      expect(enforcer.isGroupAllowed("myteam/deep/nested")).toBe(true);
    });

    it("should deny subgroups when includeSubgroups is false", () => {
      const enforcer = new ScopeEnforcer({
        group: "myteam",
        includeSubgroups: false,
      });

      expect(enforcer.isGroupAllowed("myteam")).toBe(true);
      expect(enforcer.isGroupAllowed("myteam/subgroup")).toBe(false);
    });

    it("should handle numeric group IDs", () => {
      const enforcer = new ScopeEnforcer({
        groups: ["myteam", "12345"],
      });

      expect(enforcer.isGroupAllowed("12345")).toBe(true);
    });
  });

  describe("groups list scope", () => {
    it("should allow groups in list via isGroupAllowed", () => {
      const enforcer = new ScopeEnforcer({
        groups: ["team1", "team2", "other-team"],
      });

      expect(enforcer.isGroupAllowed("team1")).toBe(true);
      expect(enforcer.isGroupAllowed("team2")).toBe(true);
      expect(enforcer.isGroupAllowed("other-team")).toBe(true);
    });

    it("should deny groups not in list", () => {
      const enforcer = new ScopeEnforcer({
        groups: ["team1", "team2"],
      });

      expect(enforcer.isGroupAllowed("team3")).toBe(false);
      expect(enforcer.isGroupAllowed("unknown")).toBe(false);
    });
  });

  describe("enforceGroup()", () => {
    it("should not throw for allowed group", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });

      expect(() => enforcer.enforceGroup("myteam")).not.toThrow();
    });

    it("should throw ScopeViolationError for denied group", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });

      expect(() => enforcer.enforceGroup("other-team")).toThrow(ScopeViolationError);
    });

    it("should include scope info in error for group violation", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });

      let thrownError: ScopeViolationError | undefined;
      try {
        enforcer.enforceGroup("other-team");
      } catch (error) {
        thrownError = error as ScopeViolationError;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(ScopeViolationError);
      expect(thrownError!.attemptedTarget).toBe("other-team");
      expect(thrownError!.message).toContain("other-team");
    });
  });

  describe("hasGroupRestrictions()", () => {
    it("should return true when group is set", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });
      expect(enforcer.hasGroupRestrictions()).toBe(true);
    });

    it("should return true when groups list is set", () => {
      const enforcer = new ScopeEnforcer({ groups: ["team1", "team2"] });
      expect(enforcer.hasGroupRestrictions()).toBe(true);
    });

    it("should return true when namespace is set", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam" });
      expect(enforcer.hasGroupRestrictions()).toBe(true);
    });

    it("should return false for empty scope", () => {
      const enforcer = new ScopeEnforcer({});
      expect(enforcer.hasGroupRestrictions()).toBe(false);
    });

    it("should return false for project-only scope", () => {
      const enforcer = new ScopeEnforcer({ project: "team/project" });
      expect(enforcer.hasGroupRestrictions()).toBe(false);
    });

    it("should return false for empty groups array", () => {
      const enforcer = new ScopeEnforcer({ groups: [] });
      expect(enforcer.hasGroupRestrictions()).toBe(false);
    });
  });

  describe("getScopeDescription() with groups", () => {
    it("should describe group scope", () => {
      const enforcer = new ScopeEnforcer({ group: "myteam" });
      // Group scope includes /* wildcard to indicate subgroups
      expect(enforcer.getScopeDescription()).toBe("group: myteam/*");
    });

    it("should describe short groups list", () => {
      const enforcer = new ScopeEnforcer({
        groups: ["g1", "g2", "g3"],
      });
      expect(enforcer.getScopeDescription()).toBe("groups: g1, g2, g3");
    });

    it("should describe long groups list with count", () => {
      const enforcer = new ScopeEnforcer({
        groups: ["g1", "g2", "g3", "g4", "g5"],
      });
      expect(enforcer.getScopeDescription()).toBe("5 allowed groups");
    });
  });

  describe("numeric IDs", () => {
    it("should deny numeric IDs not in explicit list", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      // Can't verify numeric ID without API call, so deny by default
      expect(enforcer.isAllowed("12345")).toBe(false);
    });

    it("should allow numeric IDs in explicit projects list", () => {
      const enforcer = new ScopeEnforcer({
        projects: ["myteam/backend", "12345"],
      });

      expect(enforcer.isAllowed("12345")).toBe(true);
    });
  });

  describe("enforce()", () => {
    it("should not throw for allowed project", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      expect(() => enforcer.enforce("myteam/backend")).not.toThrow();
    });

    it("should throw ScopeViolationError for denied project", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      expect(() => enforcer.enforce("other/project")).toThrow(ScopeViolationError);
    });

    it("should include scope info in error", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });

      let thrownError: ScopeViolationError | undefined;
      try {
        enforcer.enforce("other/project");
      } catch (error) {
        thrownError = error as ScopeViolationError;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(ScopeViolationError);
      expect(thrownError!.attemptedTarget).toBe("other/project");
      expect(thrownError!.allowedScope.project).toBe("myteam/backend");
      expect(thrownError!.message).toContain("other/project");
      expect(thrownError!.message).toContain("myteam/backend");
    });
  });

  describe("fromPreset()", () => {
    it("should create enforcer from preset with scope", () => {
      const preset: ProjectPreset = {
        scope: { project: "myteam/backend" },
      };

      const enforcer = ScopeEnforcer.fromPreset(preset);

      expect(enforcer).not.toBeNull();
      expect(enforcer?.isAllowed("myteam/backend")).toBe(true);
    });

    it("should return null for preset without scope", () => {
      const preset: ProjectPreset = {
        read_only: true,
      };

      const enforcer = ScopeEnforcer.fromPreset(preset);

      expect(enforcer).toBeNull();
    });
  });

  describe("hasRestrictions()", () => {
    it("should return true when project is set", () => {
      const enforcer = new ScopeEnforcer({ project: "test" });
      expect(enforcer.hasRestrictions()).toBe(true);
    });

    it("should return true when namespace is set", () => {
      const enforcer = new ScopeEnforcer({ namespace: "test" });
      expect(enforcer.hasRestrictions()).toBe(true);
    });

    it("should return true when projects list is set", () => {
      const enforcer = new ScopeEnforcer({ projects: ["test"] });
      expect(enforcer.hasRestrictions()).toBe(true);
    });

    it("should return false for empty scope", () => {
      const enforcer = new ScopeEnforcer({});
      expect(enforcer.hasRestrictions()).toBe(false);
    });

    it("should return false for empty projects array", () => {
      const enforcer = new ScopeEnforcer({ projects: [] });
      expect(enforcer.hasRestrictions()).toBe(false);
    });
  });

  describe("getScope()", () => {
    it("should return the scope configuration", () => {
      const scope = { project: "myteam/backend", namespace: "myteam" };
      const enforcer = new ScopeEnforcer(scope);

      expect(enforcer.getScope()).toEqual(scope);
    });
  });

  describe("getScopeDescription()", () => {
    it("should describe project scope", () => {
      const enforcer = new ScopeEnforcer({ project: "myteam/backend" });
      expect(enforcer.getScopeDescription()).toBe("project: myteam/backend");
    });

    it("should describe namespace scope", () => {
      const enforcer = new ScopeEnforcer({ namespace: "myteam" });
      expect(enforcer.getScopeDescription()).toBe("namespace: myteam/*");
    });

    it("should describe short projects list", () => {
      const enforcer = new ScopeEnforcer({
        projects: ["p1", "p2", "p3"],
      });
      expect(enforcer.getScopeDescription()).toBe("projects: p1, p2, p3");
    });

    it("should describe long projects list with count", () => {
      const enforcer = new ScopeEnforcer({
        projects: ["p1", "p2", "p3", "p4", "p5"],
      });
      expect(enforcer.getScopeDescription()).toBe("5 allowed projects");
    });
  });
});

describe("extractProjectsFromArgs", () => {
  it("should extract project_id", () => {
    const args = { project_id: "myteam/backend" };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toContain("myteam/backend");
  });

  it("should extract projectId", () => {
    const args = { projectId: "myteam/backend" };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toContain("myteam/backend");
  });

  it("should extract namespace", () => {
    const args = { namespace: "myteam/backend" };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toContain("myteam/backend");
  });

  it("should extract multiple project fields", () => {
    const args = {
      project_id: "project1",
      namespace: "project2",
    };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toContain("project1");
    expect(projects).toContain("project2");
  });

  it("should ignore non-string values", () => {
    const args = {
      project_id: 12345,
      namespace: null,
      fullPath: undefined,
    };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toHaveLength(0);
  });

  it("should ignore empty strings", () => {
    const args = {
      project_id: "",
      namespace: "  ",
    };
    const projects = extractProjectsFromArgs(args);
    expect(projects).toHaveLength(0);
  });
});

describe("enforceArgsScope", () => {
  it("should allow valid args", () => {
    const enforcer = new ScopeEnforcer({ project: "myteam/backend" });
    const args = { project_id: "myteam/backend", action: "list" };

    expect(() => enforceArgsScope(enforcer, args)).not.toThrow();
  });

  it("should throw on invalid project", () => {
    const enforcer = new ScopeEnforcer({ project: "myteam/backend" });
    const args = { project_id: "other/project", action: "list" };

    expect(() => enforceArgsScope(enforcer, args)).toThrow(ScopeViolationError);
  });

  it("should check all project fields", () => {
    const enforcer = new ScopeEnforcer({ project: "allowed/project" });
    const args = {
      project_id: "allowed/project",
      namespace: "other/project", // This should trigger violation
    };

    expect(() => enforceArgsScope(enforcer, args)).toThrow(ScopeViolationError);
  });

  it("should pass when no project fields in args", () => {
    const enforcer = new ScopeEnforcer({ project: "myteam/backend" });
    const args = { action: "list", page: 1 };

    expect(() => enforceArgsScope(enforcer, args)).not.toThrow();
  });

  it("should throw on invalid group", () => {
    const enforcer = new ScopeEnforcer({ group: "allowed-group" });
    const args = { group_id: "other-group", action: "list" };

    expect(() => enforceArgsScope(enforcer, args)).toThrow(ScopeViolationError);
  });

  it("should allow valid group args", () => {
    const enforcer = new ScopeEnforcer({ group: "allowed-group" });
    const args = { group_id: "allowed-group", action: "list" };

    expect(() => enforceArgsScope(enforcer, args)).not.toThrow();
  });

  it("should check both project and group fields", () => {
    const enforcer = new ScopeEnforcer({
      project: "allowed/project",
      group: "allowed-group",
    });
    const args = {
      project_id: "allowed/project",
      group_id: "other-group", // This should trigger violation
    };

    expect(() => enforceArgsScope(enforcer, args)).toThrow(ScopeViolationError);
  });
});

describe("extractGroupsFromArgs", () => {
  it("should extract group_id", () => {
    const args = { group_id: "myteam" };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toContain("myteam");
  });

  it("should extract groupId", () => {
    const args = { groupId: "myteam" };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toContain("myteam");
  });

  it("should extract group", () => {
    const args = { group: "myteam" };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toContain("myteam");
  });

  it("should extract multiple group fields", () => {
    const args = {
      group_id: "group1",
      groupId: "group2",
    };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toContain("group1");
    expect(groups).toContain("group2");
  });

  it("should ignore numeric group IDs (not supported)", () => {
    // Note: extractGroupsFromArgs only handles string values
    // Numeric IDs should be converted to strings by the caller if needed
    const args = { group_id: 12345 };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toHaveLength(0);
  });

  it("should ignore non-string values", () => {
    const args = {
      group_id: null,
      groupId: undefined,
      group: { nested: "object" },
    };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toHaveLength(0);
  });

  it("should ignore empty strings", () => {
    const args = {
      group_id: "",
      groupId: "  ",
    };
    const groups = extractGroupsFromArgs(args);
    expect(groups).toHaveLength(0);
  });
});
