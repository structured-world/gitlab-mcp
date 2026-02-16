import {
  filesToolRegistry,
  getFilesReadOnlyToolNames,
  getFilesToolDefinitions,
  getFilteredFilesTools,
} from "../../../../src/entities/files/registry";
import { enhancedFetch } from "../../../../src/utils/fetch";

// Mock the fetch function to avoid actual API calls
jest.mock("../../../../src/utils/fetch", () => ({
  enhancedFetch: jest.fn(),
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock environment variables
const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: "https://gitlab.example.com",
    GITLAB_TOKEN: "test-token-12345",
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  mockEnhancedFetch.mockReset();
});

describe("Files Registry", () => {
  describe("Registry Structure", () => {
    it("should be a Map instance", () => {
      expect(filesToolRegistry instanceof Map).toBe(true);
    });

    it("should contain expected CQRS tools", () => {
      const toolNames = Array.from(filesToolRegistry.keys());

      expect(toolNames).toContain("browse_files");
      expect(toolNames).toContain("manage_files");
      expect(toolNames).toHaveLength(2);
    });

    it("should have tools with valid structure", () => {
      for (const [toolName, tool] of filesToolRegistry) {
        expect(tool).toHaveProperty("name", toolName);
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool).toHaveProperty("handler");
        expect(typeof tool.description).toBe("string");
        expect(typeof tool.handler).toBe("function");
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it("should have unique tool names", () => {
      const toolNames = Array.from(filesToolRegistry.keys());
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });
  });

  describe("Tool Definitions", () => {
    it("should have proper browse_files tool", () => {
      const tool = filesToolRegistry.get("browse_files");

      expect(tool).toBeDefined();
      expect(tool?.name).toBe("browse_files");
      expect(tool?.description).toContain("file structure");
      expect(tool?.description).toContain("tree");
      expect(tool?.description).toContain("content");
      expect(tool?.inputSchema).toBeDefined();
    });

    it("should have proper manage_files tool", () => {
      const tool = filesToolRegistry.get("manage_files");

      expect(tool).toBeDefined();
      expect(tool?.name).toBe("manage_files");
      expect(tool?.description).toContain("Create, update, or upload");
      expect(tool?.description).toContain("single");
      expect(tool?.description).toContain("batch");
      expect(tool?.inputSchema).toBeDefined();
    });
  });

  describe("Read-Only Tools Function", () => {
    it("should return an array of read-only tool names", () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(Array.isArray(readOnlyTools)).toBe(true);
      expect(readOnlyTools.length).toBeGreaterThan(0);
    });

    it("should include only browse_files as read-only", () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(readOnlyTools).toContain("browse_files");
      expect(readOnlyTools).toHaveLength(1);
    });

    it("should not include manage_files (write tool)", () => {
      const readOnlyTools = getFilesReadOnlyToolNames();

      expect(readOnlyTools).not.toContain("manage_files");
    });

    it("should return tools that exist in the registry", () => {
      const readOnlyTools = getFilesReadOnlyToolNames();
      const registryKeys = Array.from(filesToolRegistry.keys());

      for (const toolName of readOnlyTools) {
        expect(registryKeys).toContain(toolName);
      }
    });
  });

  describe("Tool Handlers", () => {
    it("should have handlers that are async functions", () => {
      for (const [, tool] of filesToolRegistry) {
        expect(tool.handler.constructor.name).toBe("AsyncFunction");
      }
    });

    it("should have handlers that accept arguments", () => {
      for (const [, tool] of filesToolRegistry) {
        expect(tool.handler.length).toBe(1);
      }
    });
  });

  describe("Registry Consistency", () => {
    it("should have all tools defined in registry", () => {
      const expectedTools = ["browse_files", "manage_files"];

      for (const toolName of expectedTools) {
        expect(filesToolRegistry.has(toolName)).toBe(true);
      }
    });

    it("should have consistent tool count", () => {
      const toolCount = filesToolRegistry.size;
      const readOnlyCount = getFilesReadOnlyToolNames().length;

      expect(toolCount).toBeGreaterThan(readOnlyCount);
      expect(toolCount).toBe(2);
    });
  });

  describe("Helper Functions", () => {
    describe("getFilesToolDefinitions", () => {
      it("should return all tool definitions", () => {
        const definitions = getFilesToolDefinitions();
        expect(definitions).toHaveLength(2);
        expect(
          definitions.every(def => def.name && def.description && def.inputSchema && def.handler)
        ).toBe(true);
      });
    });

    describe("getFilteredFilesTools", () => {
      it("should return all tools when readOnlyMode is false", () => {
        const tools = getFilteredFilesTools(false);
        expect(tools).toHaveLength(2);
      });

      it("should return only read-only tools when readOnlyMode is true", () => {
        const tools = getFilteredFilesTools(true);
        expect(tools).toHaveLength(1);
        const toolNames = tools.map(t => t.name);
        expect(toolNames).toContain("browse_files");
        expect(toolNames).not.toContain("manage_files");
      });
    });
  });

  describe("Handler Functions", () => {
    const mockResponse = (data: unknown, ok = true, status = 200, statusText?: string) =>
      ({
        ok,
        status,
        statusText: statusText ?? (ok ? "OK" : "Error"),
        json: jest.fn().mockResolvedValue(data),
        text: jest.fn().mockResolvedValue(typeof data === "string" ? data : JSON.stringify(data)),
        headers: {
          get: jest.fn().mockReturnValue("text/plain; charset=utf-8"),
        },
      }) as unknown as Response;

    describe("browse_files handler", () => {
      describe('action: "tree"', () => {
        it("should get repository tree with basic params", async () => {
          const mockTree = [
            { id: "1", name: "file1.txt", type: "blob", path: "file1.txt" },
            { id: "2", name: "folder1", type: "tree", path: "folder1" },
          ];

          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockTree));

          const tool = filesToolRegistry.get("browse_files")!;
          const result = await tool.handler({
            action: "tree",
            project_id: "test/project",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            expect.stringContaining(
              "https://gitlab.example.com/api/v4/projects/test%2Fproject/repository/tree"
            )
          );
          expect(result).toEqual(mockTree);
        });

        it("should get repository tree with optional parameters", async () => {
          const mockTree = [{ id: "1", name: "file1.txt", type: "blob" }];
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockTree));

          const tool = filesToolRegistry.get("browse_files")!;
          await tool.handler({
            action: "tree",
            project_id: "test/project",
            path: "src/",
            ref: "develop",
            recursive: true,
            per_page: 50,
          });

          const call = mockEnhancedFetch.mock.calls[0];
          const url = call[0];
          expect(url).toContain("path=src%2F");
          expect(url).toContain("ref=develop");
          expect(url).toContain("recursive=true");
          expect(url).toContain("per_page=50");
        });

        it("should handle API errors", async () => {
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(null, false, 404));

          const tool = filesToolRegistry.get("browse_files")!;

          await expect(
            tool.handler({
              action: "tree",
              project_id: "nonexistent/project",
            })
          ).rejects.toThrow("GitLab API error: 404 Error");
        });
      });

      describe('action: "content"', () => {
        it("should get file contents", async () => {
          const mockFileContent = "Test content from README.md";
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockFileContent));

          const tool = filesToolRegistry.get("browse_files")!;
          const result = await tool.handler({
            action: "content",
            project_id: "test/project",
            file_path: "README.md",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/repository/files/README.md/raw?"
          );
          expect(result).toEqual({
            file_path: "README.md",
            ref: "HEAD",
            size: mockFileContent.length,
            content: mockFileContent,
            content_type: "text/plain; charset=utf-8",
          });
        });

        it("should get file contents with ref parameter", async () => {
          const mockFileContent = '{"config": "test"}';
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockFileContent));

          const tool = filesToolRegistry.get("browse_files")!;
          const result = await tool.handler({
            action: "content",
            project_id: "test/project",
            file_path: "config/config.json",
            ref: "feature-branch",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/repository/files/config%2Fconfig.json/raw?ref=feature-branch"
          );
          expect(result).toEqual({
            file_path: "config/config.json",
            ref: "feature-branch",
            size: mockFileContent.length,
            content: mockFileContent,
            content_type: "text/plain; charset=utf-8",
          });
        });

        it("should handle file not found errors", async () => {
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(null, false, 404));

          const tool = filesToolRegistry.get("browse_files")!;

          await expect(
            tool.handler({
              action: "content",
              project_id: "test/project",
              file_path: "nonexistent.txt",
            })
          ).rejects.toThrow("GitLab API error: 404 Error");
        });
      });

      describe('action: "download_attachment"', () => {
        it("should download attachment by secret and filename", async () => {
          const mockArrayBuffer = new TextEncoder().encode("binary-content").buffer;
          mockEnhancedFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
            headers: {
              get: jest.fn().mockReturnValue("image/png"),
            },
          } as unknown as Response);

          const tool = filesToolRegistry.get("browse_files")!;
          const result = await tool.handler({
            action: "download_attachment",
            project_id: "test/project",
            secret: "abc123secret",
            filename: "screenshot.png",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/uploads/abc123secret/screenshot.png"
          );
          expect(result).toEqual({
            filename: "screenshot.png",
            content: Buffer.from(mockArrayBuffer).toString("base64"),
            contentType: "image/png",
          });
        });

        it("should use default content type when header is null", async () => {
          const mockArrayBuffer = new ArrayBuffer(4);
          mockEnhancedFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
            headers: {
              get: jest.fn().mockReturnValue(null),
            },
          } as unknown as Response);

          const tool = filesToolRegistry.get("browse_files")!;
          const result = await tool.handler({
            action: "download_attachment",
            project_id: "42",
            secret: "secret-key",
            filename: "data.bin",
          });

          expect(result).toEqual({
            filename: "data.bin",
            content: Buffer.from(mockArrayBuffer).toString("base64"),
            contentType: "application/octet-stream",
          });
        });

        it("should handle API error for attachment download", async () => {
          mockEnhancedFetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: "Not Found",
          } as unknown as Response);

          const tool = filesToolRegistry.get("browse_files")!;

          await expect(
            tool.handler({
              action: "download_attachment",
              project_id: "test/project",
              secret: "invalid-secret",
              filename: "missing.pdf",
            })
          ).rejects.toThrow("GitLab API error: 404 Not Found");
        });
      });
    });

    describe("manage_files handler", () => {
      describe('action: "single"', () => {
        it("should create/update file with basic data", async () => {
          const mockResult = {
            file_path: "new-file.txt",
            branch: "main",
            commit_id: "abc123",
          };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockResult));

          const tool = filesToolRegistry.get("manage_files")!;
          const result = await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "new-file.txt",
            branch: "main",
            content: "New file content",
            commit_message: "Add new file",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/repository/files/new-file.txt",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: expect.stringContaining("branch=main"),
            }
          );
          expect(result).toEqual(mockResult);
        });

        it("should include optional parameters", async () => {
          const mockResult = { file_path: "test.txt", branch: "main" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockResult));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "test.txt",
            branch: "main",
            content: "Test content",
            commit_message: "Update file",
            author_email: "test@example.com",
            author_name: "Test Author",
            encoding: "base64",
            last_commit_id: "def456",
          });

          const call = mockEnhancedFetch.mock.calls[0];
          const body = call[1]?.body as string;
          expect(body).toContain("author_email=test%40example.com");
          expect(body).toContain("author_name=Test+Author");
          expect(body).toContain("encoding=base64");
          expect(body).toContain("last_commit_id=def456");
        });

        it("should handle creation conflicts", async () => {
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(null, false, 409));

          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "single",
              project_id: "test/project",
              file_path: "existing-file.txt",
              branch: "main",
              content: "Content",
              commit_message: "Create file",
            })
          ).rejects.toThrow("GitLab API error: 409 Error");
        });
      });

      describe('action: "batch"', () => {
        it("should push multiple files in single commit", async () => {
          const mockCommit = {
            id: "abc123",
            short_id: "abc123",
            title: "Add multiple files",
            message: "Add multiple files\n\n- Added file1.txt\n- Added file2.txt",
          };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockCommit));

          const tool = filesToolRegistry.get("manage_files")!;
          const result = await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Add multiple files",
            files: [
              {
                file_path: "file1.txt",
                content: "Content 1",
                encoding: "text",
              },
              {
                file_path: "file2.txt",
                content: "Content 2",
                execute_filemode: true,
              },
            ],
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/repository/commits",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: expect.stringContaining('"branch":"main"'),
            }
          );

          const call = mockEnhancedFetch.mock.calls[0];
          const body = JSON.parse(call[1]?.body as string);
          expect(body.actions).toHaveLength(2);
          expect(body.actions[0]).toEqual({
            action: "create",
            file_path: "file1.txt",
            content: "Content 1",
            encoding: "text",
            execute_filemode: false,
          });
          expect(body.actions[1]).toEqual({
            action: "create",
            file_path: "file2.txt",
            content: "Content 2",
            encoding: "text",
            execute_filemode: true,
          });
          expect(result).toEqual(mockCommit);
        });

        it("should include optional commit parameters", async () => {
          const mockCommit = { id: "def456", title: "Commit with author" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockCommit));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "feature",
            commit_message: "Commit with author",
            start_branch: "main",
            author_email: "author@example.com",
            author_name: "Author Name",
            files: [
              {
                file_path: "test.txt",
                content: "Test content",
              },
            ],
          });

          const call = mockEnhancedFetch.mock.calls[0];
          const body = JSON.parse(call[1]?.body as string);
          expect(body.start_branch).toBe("main");
          expect(body.author_email).toBe("author@example.com");
          expect(body.author_name).toBe("Author Name");
        });

        it("should handle empty files array", async () => {
          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "batch",
              project_id: "test/project",
              branch: "main",
              commit_message: "Empty commit",
              files: [],
            })
          ).rejects.toThrow();
        });
      });

      describe('action: "upload"', () => {
        it("should upload file for markdown use", async () => {
          const mockUpload = {
            alt: "test-image",
            url: "/uploads/abc123/test-image.png",
            markdown: "![test-image](/uploads/abc123/test-image.png)",
          };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockUpload));

          const tool = filesToolRegistry.get("manage_files")!;
          const result = await tool.handler({
            action: "upload",
            project_id: "test/project",
            file: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            filename: "test-image.png",
          });

          expect(mockEnhancedFetch).toHaveBeenCalledWith(
            "https://gitlab.example.com/api/v4/projects/test%2Fproject/uploads",
            {
              method: "POST",
              body: expect.any(FormData),
            }
          );
          expect(result).toEqual(mockUpload);
        });

        it("should handle upload errors", async () => {
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(null, false, 413));

          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "upload",
              project_id: "test/project",
              file: "base64content",
              filename: "large-file.zip",
            })
          ).rejects.toThrow("GitLab API error: 413 Error");
        });
      });
    });

    describe("Error handling", () => {
      it("should handle validation errors for browse_files", async () => {
        const tool = filesToolRegistry.get("browse_files")!;

        await expect(
          tool.handler({
            action: "content",
            project_id: 123,
            file_path: null,
          })
        ).rejects.toThrow();
      });

      it("should handle API errors with proper error messages", async () => {
        mockEnhancedFetch.mockResolvedValueOnce(mockResponse(null, false, 500));

        const tool = filesToolRegistry.get("browse_files")!;

        await expect(
          tool.handler({
            action: "tree",
            project_id: "test/project",
          })
        ).rejects.toThrow("GitLab API error: 500 Error");
      });

      it("should handle network errors", async () => {
        mockEnhancedFetch.mockRejectedValueOnce(new Error("Network error"));

        const tool = filesToolRegistry.get("manage_files")!;

        await expect(
          tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "test.txt",
            branch: "main",
            content: "content",
            commit_message: "test",
          })
        ).rejects.toThrow("Network error");
      });
    });

    describe('manage_files "overwrite" parameter - Issue #326', () => {
      describe("single action", () => {
        it("should use POST when overwrite is not provided (default behavior)", async () => {
          const mockResult = { file_path: "README.md", branch: "main" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockResult));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "README.md",
            content: "# Hello",
            commit_message: "Add README",
            branch: "main",
          });

          const calls = mockEnhancedFetch.mock.calls;
          expect(calls).toHaveLength(1);
          expect(calls[0][1]?.method).toBe("POST");
        });

        it("should use POST when overwrite is false", async () => {
          const mockResult = { file_path: "README.md", branch: "main" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockResult));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "README.md",
            content: "# Hello",
            commit_message: "Add README",
            branch: "main",
            overwrite: false,
          });

          const calls = mockEnhancedFetch.mock.calls;
          expect(calls).toHaveLength(1);
          expect(calls[0][1]?.method).toBe("POST");
        });

        it("should check existence and use PUT when overwrite=true and file exists", async () => {
          // Mock existence check (GET) - file exists
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse({ file_path: "README.md", content: "old" })
          );
          // Mock update (PUT)
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse({ file_path: "README.md", branch: "main" })
          );

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "README.md",
            content: "# Updated",
            commit_message: "Update README",
            branch: "main",
            overwrite: true,
          });

          expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
          // First call: GET to check existence
          expect(mockEnhancedFetch.mock.calls[0][0]).toContain("/repository/files/README.md");
          expect(mockEnhancedFetch.mock.calls[0][0]).toContain("ref=main");
          // Second call: PUT to update
          expect(mockEnhancedFetch.mock.calls[1][1]?.method).toBe("PUT");
        });

        it("should check existence and use POST when overwrite=true and file does not exist", async () => {
          // Mock existence check (GET) - file doesn't exist (404)
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse(null, false, 404, "Not Found - file not found")
          );
          // Mock create (POST)
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse({ file_path: "NEW.md", branch: "main" })
          );

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "NEW.md",
            content: "# New",
            commit_message: "Create file",
            branch: "main",
            overwrite: true,
          });

          expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
          // First call: GET to check existence (404)
          expect(mockEnhancedFetch.mock.calls[0][0]).toContain("/repository/files/NEW.md");
          // Second call: POST to create
          expect(mockEnhancedFetch.mock.calls[1][1]?.method).toBe("POST");
        });

        it("should re-throw non-404 errors during existence check", async () => {
          // Mock existence check (GET) - server error (500)
          // Use mockResolvedValue (not Once) to handle potential multiple calls
          mockEnhancedFetch.mockResolvedValue(mockResponse(null, false, 500));

          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "single",
              project_id: "test/project",
              file_path: "README.md",
              content: "# Test",
              commit_message: "Test",
              branch: "main",
              overwrite: true,
            })
          ).rejects.toThrow("GitLab API error: 500 Error");

          // Should call enhancedFetch for GET request, then error should be thrown
          expect(mockEnhancedFetch).toHaveBeenCalled();
        });

        it("should re-throw 404 with non-file-specific message (ref not found)", async () => {
          // Mock existence check (GET) - 404 but for ref/branch, not file
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse(null, false, 404, "Not Found - ref 'nonexistent-branch' not found")
          );

          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "single",
              project_id: "test/project",
              file_path: "README.md",
              content: "# Test",
              commit_message: "Test",
              branch: "main",
              start_branch: "nonexistent-branch",
              overwrite: true,
            })
          ).rejects.toThrow("GitLab API error: 404 Not Found");

          // Should call enhancedFetch for GET request, then re-throw non-file 404
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
        });

        it("should proceed with POST for 404 with file-specific message", async () => {
          // Mock existence check (GET) - 404 specifically for file not found
          mockEnhancedFetch
            .mockResolvedValueOnce(mockResponse(null, false, 404, "Not Found - file not found"))
            .mockResolvedValueOnce(mockResponse({ file_path: "newfile.md", branch: "main" })); // POST response

          const tool = filesToolRegistry.get("manage_files")!;

          const result = await tool.handler({
            action: "single",
            project_id: "test/project",
            file_path: "newfile.md",
            content: "# New File",
            commit_message: "Create new file",
            branch: "main",
            overwrite: true,
          });

          expect(result).toEqual({ file_path: "newfile.md", branch: "main" });
          // First call: GET to check existence (404 file not found)
          // Second call: POST to create file
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
          expect(mockEnhancedFetch.mock.calls[1][1]?.method).toBe("POST");
        });
      });

      describe("batch action", () => {
        it("should use action=create for all files when overwrite is not provided", async () => {
          const mockCommit = { id: "abc123", title: "Batch commit" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockCommit));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Batch commit",
            files: [
              { file_path: "file1.txt", content: "content1" },
              { file_path: "file2.txt", content: "content2" },
            ],
          });

          const call = mockEnhancedFetch.mock.calls[0];
          const body = JSON.parse(call[1]?.body as string);
          expect(body.actions).toHaveLength(2);
          expect(body.actions[0].action).toBe("create");
          expect(body.actions[1].action).toBe("create");
        });

        it("should use action=create for all files when overwrite is false", async () => {
          const mockCommit = { id: "abc123", title: "Batch commit" };
          mockEnhancedFetch.mockResolvedValueOnce(mockResponse(mockCommit));

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Batch commit",
            files: [
              { file_path: "file1.txt", content: "content1" },
              { file_path: "file2.txt", content: "content2" },
            ],
            overwrite: false,
          });

          const call = mockEnhancedFetch.mock.calls[0];
          const body = JSON.parse(call[1]?.body as string);
          expect(body.actions.every((a: any) => a.action === "create")).toBe(true);
        });

        it("should check each file and use correct action when overwrite=true", async () => {
          // file1.txt exists (GET returns 200), file2.txt doesn't exist (GET returns 404)
          mockEnhancedFetch
            .mockResolvedValueOnce(mockResponse({ file_path: "file1.txt", content: "old" })) // file1 GET
            .mockResolvedValueOnce(mockResponse(null, false, 404, "Not Found - file not found")) // file2 GET (404)
            .mockResolvedValueOnce(mockResponse({ id: "commit123" })); // POST commit

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Mixed batch",
            files: [
              { file_path: "file1.txt", content: "updated" },
              { file_path: "file2.txt", content: "new" },
            ],
            overwrite: true,
          });

          // Should have 3 calls: 2 GET (existence checks) + 1 POST (commit)
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(3);

          // First 2 calls are GET requests to check existence
          expect(mockEnhancedFetch.mock.calls[0][0]).toContain("/repository/files/file1.txt");
          expect(mockEnhancedFetch.mock.calls[1][0]).toContain("/repository/files/file2.txt");

          // Third call is POST to create commit
          const commitCall = mockEnhancedFetch.mock.calls[2];
          expect(commitCall[1]?.method).toBe("POST");
          const body = JSON.parse(commitCall[1]?.body as string);
          expect(body.actions).toEqual([
            {
              action: "update", // file1 exists
              file_path: "file1.txt",
              content: "updated",
              encoding: "text",
              execute_filemode: false,
            },
            {
              action: "create", // file2 doesn't exist
              file_path: "file2.txt",
              content: "new",
              encoding: "text",
              execute_filemode: false,
            },
          ]);
        });

        it("should handle all files existing when overwrite=true", async () => {
          // Both files exist (both GET return 200)
          mockEnhancedFetch
            .mockResolvedValueOnce(mockResponse({ file_path: "file1.txt" })) // file1 GET
            .mockResolvedValueOnce(mockResponse({ file_path: "file2.txt" })) // file2 GET
            .mockResolvedValueOnce(mockResponse({ id: "commit123" })); // POST commit

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Update all",
            files: [
              { file_path: "file1.txt", content: "updated1" },
              { file_path: "file2.txt", content: "updated2" },
            ],
            overwrite: true,
          });

          expect(mockEnhancedFetch).toHaveBeenCalledTimes(3);
          const commitCall = mockEnhancedFetch.mock.calls[2];
          const body = JSON.parse(commitCall[1]?.body as string);
          expect(body.actions.every((a: any) => a.action === "update")).toBe(true);
        });

        it("should handle all files not existing when overwrite=true", async () => {
          // Both files don't exist (both GET return 404)
          mockEnhancedFetch
            .mockResolvedValueOnce(mockResponse(null, false, 404, "Not Found - file not found")) // new1.txt GET (404)
            .mockResolvedValueOnce(mockResponse(null, false, 404, "Not Found - file not found")) // new2.txt GET (404)
            .mockResolvedValueOnce(mockResponse({ id: "commit123" })); // POST commit

          const tool = filesToolRegistry.get("manage_files")!;
          await tool.handler({
            action: "batch",
            project_id: "test/project",
            branch: "main",
            commit_message: "Create all",
            files: [
              { file_path: "new1.txt", content: "content1" },
              { file_path: "new2.txt", content: "content2" },
            ],
            overwrite: true,
          });

          expect(mockEnhancedFetch).toHaveBeenCalledTimes(3);
          const commitCall = mockEnhancedFetch.mock.calls[2];
          const body = JSON.parse(commitCall[1]?.body as string);
          expect(body.actions.every((a: any) => a.action === "create")).toBe(true);
        });

        it("should re-throw non-404 errors during batch existence checks", async () => {
          // First file check succeeds, second fails with 403 (Permission Denied)
          // Promise.all will re-throw the error, failing the whole batch
          mockEnhancedFetch
            .mockResolvedValueOnce(mockResponse({ file_path: "file1.txt" })) // file1 GET (200)
            .mockResolvedValueOnce(mockResponse(null, false, 403)); // file2 GET (403)

          const tool = filesToolRegistry.get("manage_files")!;

          // Should throw GitLab API error for 403 (not silently fallback to create)
          await expect(
            tool.handler({
              action: "batch",
              project_id: "test/project",
              branch: "main",
              commit_message: "Batch with permission errors",
              files: [
                { file_path: "file1.txt", content: "content1" },
                { file_path: "file2.txt", content: "content2" },
              ],
              overwrite: true,
            })
          ).rejects.toThrow("GitLab API error: 403");

          // Should have attempted 2 GET requests before failing
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
        });

        it("should re-throw 404 with non-file-specific message in batch mode", async () => {
          // Mock existence check (GET) - 404 but for ref/branch, not file
          mockEnhancedFetch.mockResolvedValueOnce(
            mockResponse(null, false, 404, "Not Found - ref 'invalid-ref' not found")
          );

          const tool = filesToolRegistry.get("manage_files")!;

          await expect(
            tool.handler({
              action: "batch",
              project_id: "test/project",
              branch: "main",
              commit_message: "Batch with invalid ref",
              files: [{ file_path: "file1.txt", content: "content1" }],
              start_branch: "invalid-ref",
              overwrite: true,
            })
          ).rejects.toThrow("GitLab API error: 404 Not Found");

          // Should have attempted 1 GET request before re-throwing
          expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
        });
      });
    });
  });
});
