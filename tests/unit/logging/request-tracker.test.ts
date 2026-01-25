/**
 * Tests for RequestTracker
 *
 * Tests request stack aggregation including:
 * - Stack lifecycle (open, update, close)
 * - Tool and action tracking
 * - GitLab response capture
 * - Detail accumulation
 * - Error handling
 * - AsyncLocalStorage context management
 */

import {
  RequestTracker,
  getRequestTracker,
  resetRequestTracker,
  getCurrentRequestId,
  runWithRequestContext,
  runWithRequestContextAsync,
} from "../../../src/logging/request-tracker";

describe("RequestTracker", () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    tracker = new RequestTracker(true);
  });

  afterEach(() => {
    tracker.clear();
  });

  describe("enable/disable", () => {
    it("is enabled by default", () => {
      expect(tracker.isEnabled()).toBe(true);
    });

    it("can be disabled", () => {
      tracker.setEnabled(false);
      expect(tracker.isEnabled()).toBe(false);
    });

    it("does not create stack when disabled", () => {
      tracker.setEnabled(false);
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp", "session-1");
      expect(tracker.hasStack("req-1")).toBe(false);
    });
  });

  describe("openStack", () => {
    it("creates a new stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp", "session-1");

      expect(tracker.hasStack("req-1")).toBe(true);
      expect(tracker.getOpenStackCount()).toBe(1);
    });

    it("stores request info in stack", () => {
      tracker.openStack("req-1", "192.168.1.100", "GET", "/health", "sess-abc");

      const stack = tracker.getStack("req-1");

      expect(stack).toBeDefined();
      expect(stack?.clientIp).toBe("192.168.1.100");
      expect(stack?.method).toBe("GET");
      expect(stack?.path).toBe("/health");
      expect(stack?.sessionId).toBe("sess-abc");
      expect(stack?.startTime).toBeLessThanOrEqual(Date.now());
    });

    it("creates stack without session ID", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");

      const stack = tracker.getStack("req-1");
      expect(stack?.sessionId).toBeUndefined();
    });
  });

  describe("setTool", () => {
    it("sets tool name on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setTool("req-1", "browse_projects", "list");

      const stack = tracker.getStack("req-1");
      expect(stack?.tool).toBe("browse_projects");
      expect(stack?.action).toBe("list");
    });

    it("ignores if stack does not exist", () => {
      // Should not throw
      tracker.setTool("non-existent", "some_tool");
    });

    it("can set tool without action", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setTool("req-1", "browse_projects");

      const stack = tracker.getStack("req-1");
      expect(stack?.tool).toBe("browse_projects");
      expect(stack?.action).toBeUndefined();
    });
  });

  describe("setGitLabResponse", () => {
    it("sets numeric status", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setGitLabResponse("req-1", 200, 150);

      const stack = tracker.getStack("req-1");
      expect(stack?.gitlabStatus).toBe(200);
      expect(stack?.gitlabDuration).toBe(150);
    });

    it("sets timeout status", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setGitLabResponse("req-1", "timeout", 10000);

      const stack = tracker.getStack("req-1");
      expect(stack?.gitlabStatus).toBe("timeout");
      expect(stack?.gitlabDuration).toBe(10000);
    });

    it("sets error status", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setGitLabResponse("req-1", "error", 50);

      const stack = tracker.getStack("req-1");
      expect(stack?.gitlabStatus).toBe("error");
    });
  });

  describe("addDetail/addDetails", () => {
    it("adds single detail", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.addDetail("req-1", "project", "test/repo");

      const stack = tracker.getStack("req-1");
      expect(stack?.details.project).toBe("test/repo");
    });

    it("adds numeric detail", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.addDetail("req-1", "items", 42);

      const stack = tracker.getStack("req-1");
      expect(stack?.details.items).toBe(42);
    });

    it("adds multiple details", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.addDetails("req-1", { namespace: "test", count: 10, enabled: true });

      const stack = tracker.getStack("req-1");
      expect(stack?.details.namespace).toBe("test");
      expect(stack?.details.count).toBe(10);
      expect(stack?.details.enabled).toBe(true);
    });
  });

  describe("setError", () => {
    it("sets error on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setError("req-1", "Connection refused");

      const stack = tracker.getStack("req-1");
      expect(stack?.error).toBe("Connection refused");
      expect(stack?.details.err).toBe("Connection refused");
    });
  });

  describe("setContext", () => {
    it("sets context on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setContext("req-1", "mygroup/myproject");

      const stack = tracker.getStack("req-1");
      expect(stack?.context).toBe("mygroup/myproject");
    });

    it("ignores if stack does not exist", () => {
      // Should not throw
      tracker.setContext("non-existent", "mygroup/myproject");
    });
  });

  describe("setReadOnly", () => {
    it("sets readOnly true on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setReadOnly("req-1", true);

      const stack = tracker.getStack("req-1");
      expect(stack?.readOnly).toBe(true);
    });

    it("sets readOnly false on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setReadOnly("req-1", false);

      const stack = tracker.getStack("req-1");
      expect(stack?.readOnly).toBe(false);
    });
  });

  describe("setSessionId", () => {
    it("sets sessionId on stack", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setSessionId("req-1", "new-session-id");

      const stack = tracker.getStack("req-1");
      expect(stack?.sessionId).toBe("new-session-id");
    });

    it("updates existing sessionId", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp", "old-session");
      tracker.setSessionId("req-1", "new-session");

      const stack = tracker.getStack("req-1");
      expect(stack?.sessionId).toBe("new-session");
    });
  });

  describe("closeStack", () => {
    it("removes stack and returns log line", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp", "session-1");
      tracker.setTool("req-1", "browse_projects", "list");

      const logLine = tracker.closeStack("req-1", 200);

      expect(tracker.hasStack("req-1")).toBe(false);
      expect(logLine).toBeDefined();
      expect(logLine).toContain("127.0.0.1");
      expect(logLine).toContain("POST");
      expect(logLine).toContain("/mcp");
      expect(logLine).toContain("200");
    });

    it("returns undefined for non-existent stack", () => {
      const logLine = tracker.closeStack("non-existent", 200);
      expect(logLine).toBeUndefined();
    });

    it("returns undefined when disabled", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.setEnabled(false);

      const logLine = tracker.closeStack("req-1", 200);
      expect(logLine).toBeUndefined();
    });
  });

  describe("closeStackWithError", () => {
    it("sets error and closes with status 0", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");

      const logLine = tracker.closeStackWithError("req-1", "connection_lost");

      expect(tracker.hasStack("req-1")).toBe(false);
      // Verify log contains the error message and status 0
      // Using regex to match duration pattern (Nms) since exact value depends on timing
      expect(logLine).toMatch(/\d+ms/); // Duration is present
      expect(logLine).toContain("connection_lost"); // Error is logged in details
      expect(logLine).toContain("POST /mcp 0"); // Status 0 for error close
    });
  });

  describe("clear", () => {
    it("removes all stacks", () => {
      tracker.openStack("req-1", "127.0.0.1", "POST", "/mcp");
      tracker.openStack("req-2", "127.0.0.1", "POST", "/mcp");
      tracker.openStack("req-3", "127.0.0.1", "POST", "/mcp");

      expect(tracker.getOpenStackCount()).toBe(3);

      tracker.clear();

      expect(tracker.getOpenStackCount()).toBe(0);
    });
  });
});

describe("Global RequestTracker", () => {
  beforeEach(() => {
    resetRequestTracker();
  });

  afterEach(() => {
    resetRequestTracker();
  });

  it("returns singleton instance", () => {
    const tracker1 = getRequestTracker();
    const tracker2 = getRequestTracker();

    expect(tracker1).toBe(tracker2);
  });

  it("creates new instance after reset", () => {
    const tracker1 = getRequestTracker();
    resetRequestTracker();
    const tracker2 = getRequestTracker();

    expect(tracker1).not.toBe(tracker2);
  });
});

describe("Request Context (AsyncLocalStorage)", () => {
  beforeEach(() => {
    resetRequestTracker();
  });

  afterEach(() => {
    resetRequestTracker();
  });

  it("returns undefined when no context", () => {
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("returns request ID within context", () => {
    runWithRequestContext("test-request-id", () => {
      expect(getCurrentRequestId()).toBe("test-request-id");
    });
  });

  it("context is isolated between runs", () => {
    runWithRequestContext("request-1", () => {
      expect(getCurrentRequestId()).toBe("request-1");
    });

    runWithRequestContext("request-2", () => {
      expect(getCurrentRequestId()).toBe("request-2");
    });

    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("works with async functions", async () => {
    await runWithRequestContextAsync("async-request", async () => {
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(getCurrentRequestId()).toBe("async-request");
    });

    expect(getCurrentRequestId()).toBeUndefined();
  });
});

describe("Context-aware methods", () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    resetRequestTracker();
    tracker = getRequestTracker();
    tracker.setEnabled(true);
  });

  afterEach(() => {
    tracker.clear();
    resetRequestTracker();
  });

  it("setToolForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setToolForCurrentRequest("browse_projects", "list");
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.tool).toBe("browse_projects");
    expect(stack?.action).toBe("list");
  });

  it("setGitLabResponseForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setGitLabResponseForCurrentRequest(200, 100);
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.gitlabStatus).toBe(200);
    expect(stack?.gitlabDuration).toBe(100);
  });

  it("addDetailForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.addDetailForCurrentRequest("project", "test/repo");
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.details.project).toBe("test/repo");
  });

  it("addDetailsForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.addDetailsForCurrentRequest({ namespace: "test", count: 5 });
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.details.namespace).toBe("test");
    expect(stack?.details.count).toBe(5);
  });

  it("setErrorForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setErrorForCurrentRequest("Something went wrong");
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.error).toBe("Something went wrong");
  });

  it("setContextForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setContextForCurrentRequest("mygroup/myproject");
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.context).toBe("mygroup/myproject");
  });

  it("setReadOnlyForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setReadOnlyForCurrentRequest(true);
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.readOnly).toBe(true);
  });

  it("setSessionIdForCurrentRequest works within context", () => {
    tracker.openStack("ctx-req", "127.0.0.1", "POST", "/mcp");

    runWithRequestContext("ctx-req", () => {
      tracker.setSessionIdForCurrentRequest("new-session-id");
    });

    const stack = tracker.getStack("ctx-req");
    expect(stack?.sessionId).toBe("new-session-id");
  });

  it("context-aware methods are no-op without context", () => {
    tracker.openStack("some-req", "127.0.0.1", "POST", "/mcp");

    // These should not throw and should not affect any stack
    tracker.setToolForCurrentRequest("some_tool");
    tracker.setGitLabResponseForCurrentRequest(200);
    tracker.addDetailForCurrentRequest("key", "value");
    tracker.setErrorForCurrentRequest("error");
    tracker.setContextForCurrentRequest("mygroup/proj");
    tracker.setReadOnlyForCurrentRequest(true);
    tracker.setSessionIdForCurrentRequest("new-session");

    // Stack should be unchanged
    const stack = tracker.getStack("some-req");
    expect(stack?.tool).toBeUndefined();
    expect(stack?.gitlabStatus).toBeUndefined();
    expect(stack?.details.key).toBeUndefined();
    expect(stack?.error).toBeUndefined();
    expect(stack?.context).toBeUndefined();
    expect(stack?.readOnly).toBeUndefined();
    expect(stack?.sessionId).toBeUndefined();
  });
});
