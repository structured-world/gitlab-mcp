import {
  extractSimpleId,
  normalizeWorkItemGid,
  toGid,
  toGids,
  extractSimpleIds,
  cleanGidsFromObject,
  cleanWorkItemResponse,
  convertTypeNamesToGids,
  type GitLabWorkItem,
  type GitLabWorkItemType,
} from "../../../src/utils/idConversion";

describe("idConversion utils", () => {
  describe("extractSimpleId", () => {
    it("should extract simple ID from GID", () => {
      expect(extractSimpleId("gid://gitlab/WorkItem/123")).toBe("123");
      expect(extractSimpleId("gid://gitlab/User/456")).toBe("456");
      expect(extractSimpleId("gid://gitlab/Project/789")).toBe("789");
    });

    it("should return simple ID as-is if already simple", () => {
      expect(extractSimpleId("123")).toBe("123");
      expect(extractSimpleId("simple-id")).toBe("simple-id");
    });

    it("should handle non-string inputs", () => {
      expect(extractSimpleId(null as any)).toBe(null);
      expect(extractSimpleId(undefined as any)).toBe(undefined);
      expect(extractSimpleId(123 as any)).toBe(123);
    });
  });

  describe("normalizeWorkItemGid", () => {
    it("should normalize Issue GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/Issue/5953")).toBe("gid://gitlab/WorkItem/5953");
    });

    it("should normalize Epic GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/Epic/123")).toBe("gid://gitlab/WorkItem/123");
    });

    it("should normalize Task GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/Task/456")).toBe("gid://gitlab/WorkItem/456");
    });

    it("should normalize Incident GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/Incident/789")).toBe("gid://gitlab/WorkItem/789");
    });

    it("should normalize TestCase GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/TestCase/111")).toBe("gid://gitlab/WorkItem/111");
    });

    it("should normalize Requirement GID to WorkItem GID", () => {
      expect(normalizeWorkItemGid("gid://gitlab/Requirement/222")).toBe(
        "gid://gitlab/WorkItem/222"
      );
    });

    it("should keep WorkItem GID unchanged", () => {
      expect(normalizeWorkItemGid("gid://gitlab/WorkItem/5953")).toBe("gid://gitlab/WorkItem/5953");
    });

    it("should keep simple ID unchanged", () => {
      expect(normalizeWorkItemGid("5953")).toBe("5953");
    });

    it("should keep other entity GIDs unchanged", () => {
      expect(normalizeWorkItemGid("gid://gitlab/User/123")).toBe("gid://gitlab/User/123");
      expect(normalizeWorkItemGid("gid://gitlab/Project/456")).toBe("gid://gitlab/Project/456");
    });

    it("should handle non-string inputs", () => {
      expect(normalizeWorkItemGid(null as any)).toBe(null);
      expect(normalizeWorkItemGid(undefined as any)).toBe(undefined);
    });
  });

  describe("toGid", () => {
    it("should convert simple ID to GID", () => {
      expect(toGid("123", "WorkItem")).toBe("gid://gitlab/WorkItem/123");
      expect(toGid("456", "User")).toBe("gid://gitlab/User/456");
      expect(toGid("789", "Project")).toBe("gid://gitlab/Project/789");
    });

    it("should return GID as-is if already a GID", () => {
      const gid = "gid://gitlab/WorkItem/123";
      expect(toGid(gid, "WorkItem")).toBe(gid);
    });

    it("should normalize legacy Issue GID to WorkItem GID", () => {
      expect(toGid("gid://gitlab/Issue/5953", "WorkItem")).toBe("gid://gitlab/WorkItem/5953");
    });

    it("should normalize legacy Epic GID to WorkItem GID", () => {
      expect(toGid("gid://gitlab/Epic/123", "WorkItem")).toBe("gid://gitlab/WorkItem/123");
    });

    it("should not normalize GIDs for non-WorkItem entity types", () => {
      expect(toGid("gid://gitlab/User/123", "User")).toBe("gid://gitlab/User/123");
    });
  });

  describe("toGids", () => {
    it("should convert array of simple IDs to GIDs", () => {
      const result = toGids(["123", "456"], "User");
      expect(result).toEqual(["gid://gitlab/User/123", "gid://gitlab/User/456"]);
    });

    it("should handle mixed simple IDs and existing GIDs", () => {
      const result = toGids(["123", "gid://gitlab/User/456"], "User");
      expect(result).toEqual(["gid://gitlab/User/123", "gid://gitlab/User/456"]);
    });

    it("should normalize legacy GIDs when entityType is WorkItem", () => {
      const result = toGids(["gid://gitlab/Issue/123", "gid://gitlab/Epic/456", "789"], "WorkItem");
      expect(result).toEqual([
        "gid://gitlab/WorkItem/123",
        "gid://gitlab/WorkItem/456",
        "gid://gitlab/WorkItem/789",
      ]);
    });
  });

  describe("extractSimpleIds", () => {
    it("should extract simple IDs from array of GIDs", () => {
      const result = extractSimpleIds(["gid://gitlab/User/123", "gid://gitlab/User/456"]);
      expect(result).toEqual(["123", "456"]);
    });

    it("should handle mixed GIDs and simple IDs", () => {
      const result = extractSimpleIds(["gid://gitlab/User/123", "456"]);
      expect(result).toEqual(["123", "456"]);
    });
  });

  describe("cleanGidsFromObject", () => {
    it("should clean GIDs from object", () => {
      const input = {
        id: "gid://gitlab/WorkItem/123",
        assignee: {
          id: "gid://gitlab/User/456",
          name: "John Doe",
        },
        labels: [{ id: "gid://gitlab/ProjectLabel/789", title: "bug" }],
        regularField: "unchanged",
      };

      const result = cleanGidsFromObject(input);

      expect(result).toEqual({
        id: "123",
        assignee: {
          id: "456",
          name: "John Doe",
        },
        labels: [{ id: "789", title: "bug" }],
        regularField: "unchanged",
      });
    });

    it("should handle null and non-object inputs", () => {
      expect(cleanGidsFromObject(null)).toBe(null);
      expect(cleanGidsFromObject("string")).toBe("string");
      expect(cleanGidsFromObject(123)).toBe(123);
    });

    it("should handle arrays", () => {
      const input = [{ id: "gid://gitlab/WorkItem/123" }, { id: "gid://gitlab/WorkItem/456" }];

      const result = cleanGidsFromObject(input);
      expect(result).toEqual([{ id: "123" }, { id: "456" }]);
    });
  });

  describe("cleanWorkItemResponse", () => {
    it("should clean work item response", () => {
      const workItem: GitLabWorkItem = {
        id: "gid://gitlab/WorkItem/123",
        iid: "1",
        title: "Test Work Item",
        workItemType: { id: "gid://gitlab/WorkItems::Type/5", name: "Epic" },
        widgets: [
          {
            type: "ASSIGNEES",
            assignees: {
              nodes: [{ id: "gid://gitlab/User/456", username: "john" }],
            },
          },
        ],
      };

      const result = cleanWorkItemResponse(workItem);

      expect(result.id).toBe("123");
      expect(result.workItemType).toBe("Epic");
      expect(result.widgets?.[0].assignees?.nodes?.[0].id).toBe("456");
    });

    it("should handle null work item", () => {
      expect(cleanWorkItemResponse(null as any)).toBe(null);
    });

    it("should handle work item with string workItemType", () => {
      const workItem: GitLabWorkItem = {
        id: "gid://gitlab/WorkItem/123",
        workItemType: "Epic",
      };

      const result = cleanWorkItemResponse(workItem);
      expect(result.workItemType).toBe("Epic");
    });

    it("should clean linked items widget GIDs", () => {
      const workItem: GitLabWorkItem = {
        id: "gid://gitlab/WorkItem/100",
        widgets: [
          {
            type: "LINKED_ITEMS",
            linkedItems: {
              nodes: [
                {
                  linkType: "RELATED",
                  workItem: { id: "gid://gitlab/WorkItem/200", title: "Linked" },
                },
                {
                  linkType: "BLOCKS",
                  workItem: { id: "gid://gitlab/WorkItem/300", title: "Blocked" },
                },
              ],
            },
          },
        ],
      };

      const result = cleanWorkItemResponse(workItem);
      const linkedWidget = result.widgets?.[0];
      expect(linkedWidget?.linkedItems?.nodes?.[0].linkType).toBe("RELATED");
      expect(linkedWidget?.linkedItems?.nodes?.[0].workItem?.id).toBe("200");
      expect(linkedWidget?.linkedItems?.nodes?.[1].linkType).toBe("BLOCKS");
      expect(linkedWidget?.linkedItems?.nodes?.[1].workItem?.id).toBe("300");
    });
  });

  describe("convertTypeNamesToGids", () => {
    const mockGetWorkItemTypes = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock console.warn to avoid noise in tests
      jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return empty array for empty input", async () => {
      const result = await convertTypeNamesToGids([], "test-namespace", mockGetWorkItemTypes);
      expect(result).toEqual([]);
      expect(mockGetWorkItemTypes).not.toHaveBeenCalled();
    });

    it("should return empty array for null input", async () => {
      const result = await convertTypeNamesToGids(
        null as any,
        "test-namespace",
        mockGetWorkItemTypes
      );
      expect(result).toEqual([]);
      expect(mockGetWorkItemTypes).not.toHaveBeenCalled();
    });

    it("should convert valid type names to GIDs", async () => {
      const mockTypes: GitLabWorkItemType[] = [
        { id: "gid://gitlab/WorkItems::Type/1", name: "Epic" },
        { id: "gid://gitlab/WorkItems::Type/2", name: "Issue" },
        { id: "gid://gitlab/WorkItems::Type/3", name: "Task" },
      ];

      mockGetWorkItemTypes.mockResolvedValue(mockTypes);

      const result = await convertTypeNamesToGids(
        ["EPIC", "ISSUE"],
        "test-namespace",
        mockGetWorkItemTypes
      );

      expect(result).toEqual(["gid://gitlab/WorkItems::Type/1", "gid://gitlab/WorkItems::Type/2"]);
      expect(mockGetWorkItemTypes).toHaveBeenCalledWith("test-namespace");
    });

    it("should handle case insensitive type names", async () => {
      const mockTypes: GitLabWorkItemType[] = [
        { id: "gid://gitlab/WorkItems::Type/1", name: "Epic" },
      ];

      mockGetWorkItemTypes.mockResolvedValue(mockTypes);

      const result = await convertTypeNamesToGids(
        ["epic", "EPIC"],
        "test-namespace",
        mockGetWorkItemTypes
      );

      expect(result).toEqual(["gid://gitlab/WorkItems::Type/1", "gid://gitlab/WorkItems::Type/1"]);
    });

    it("should warn about unknown type names", async () => {
      const mockTypes: GitLabWorkItemType[] = [
        { id: "gid://gitlab/WorkItems::Type/1", name: "Epic" },
      ];

      mockGetWorkItemTypes.mockResolvedValue(mockTypes);
      const consoleSpy = jest.spyOn(console, "warn");

      const result = await convertTypeNamesToGids(
        ["UNKNOWN"],
        "test-namespace",
        mockGetWorkItemTypes
      );

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Work item type "UNKNOWN" not found in namespace "test-namespace". Available types: Epic'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "No valid work item types found for filtering. Using no type filter."
      );
    });

    it("should return empty array and warn when no valid types found", async () => {
      const mockTypes: GitLabWorkItemType[] = [
        { id: "gid://gitlab/WorkItems::Type/1", name: "Epic" },
      ];

      mockGetWorkItemTypes.mockResolvedValue(mockTypes);
      const consoleSpy = jest.spyOn(console, "warn");

      const result = await convertTypeNamesToGids(
        ["INVALID1", "INVALID2"],
        "test-namespace",
        mockGetWorkItemTypes
      );

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        "No valid work item types found for filtering. Using no type filter."
      );
    });
  });
});
