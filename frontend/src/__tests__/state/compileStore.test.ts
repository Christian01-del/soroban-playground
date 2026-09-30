import { useCompileStore } from "../../state/compileStore";

describe("useCompileStore", () => {
  beforeEach(() => {
    useCompileStore.getState().reset();
  });

  describe("initial state", () => {
    it("should initialize with default values", () => {
      const state = useCompileStore.getState();
      expect(state.isCompiling).toBe(false);
      expect(state.status).toBe("idle");
      expect(state.message).toBe("");
      expect(state.progress).toBe(0);
      expect(state.activeWorkers).toBe(0);
      expect(state.queueLength).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe("startCompile", () => {
    it("should set compiling state and clear previous error", () => {
      useCompileStore.getState().failCompile("previous error");
      useCompileStore.getState().startCompile();
      const state = useCompileStore.getState();
      expect(state.isCompiling).toBe(true);
      expect(state.status).toBe("queued");
      expect(state.message).toBe("Queuing compilation...");
      expect(state.progress).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  describe("updateProgress", () => {
    it("should update progress fields", () => {
      useCompileStore.getState().updateProgress({
        status: "building",
        message: "Compiling files...",
        progress: 45,
        queueLength: 2,
        activeWorkers: 3,
      });

      const state = useCompileStore.getState();
      expect(state.status).toBe("compiling");
      expect(state.message).toBe("Compiling files...");
      expect(state.progress).toBe(45);
      expect(state.queueLength).toBe(2);
      expect(state.activeWorkers).toBe(3);
    });

    it("should map queued status correctly", () => {
      useCompileStore.getState().updateProgress({ status: "queued" });
      expect(useCompileStore.getState().status).toBe("queued");
    });

    it("should keep existing values for unspecified fields", () => {
      useCompileStore.getState().updateProgress({ progress: 50 });
      expect(useCompileStore.getState().progress).toBe(50);
      expect(useCompileStore.getState().activeWorkers).toBe(0);
    });
  });

  describe("successCompile", () => {
    it("should set success state", () => {
      useCompileStore.getState().successCompile("Build complete!");
      const state = useCompileStore.getState();
      expect(state.isCompiling).toBe(false);
      expect(state.status).toBe("success");
      expect(state.message).toBe("Build complete!");
      expect(state.progress).toBe(100);
      expect(state.error).toBeNull();
    });

    it("should use default message when none provided", () => {
      useCompileStore.getState().successCompile();
      expect(useCompileStore.getState().message).toBe("Compiled successfully.");
    });
  });

  describe("failCompile", () => {
    it("should set failed state with error message", () => {
      useCompileStore.getState().failCompile("Syntax error on line 42");
      const state = useCompileStore.getState();
      expect(state.isCompiling).toBe(false);
      expect(state.status).toBe("failed");
      expect(state.message).toBe("Syntax error on line 42");
      expect(state.progress).toBe(0);
      expect(state.error).not.toBeNull();
      expect(state.error?.message).toBe("Syntax error on line 42");
    });

    it("should classify syntax errors as compilation type", () => {
      useCompileStore.getState().failCompile("Syntax error");
      expect(useCompileStore.getState().error?.type).toBe("compilation");
      expect(useCompileStore.getState().error?.retryable).toBe(false);
    });

    it("should classify network errors as retryable", () => {
      useCompileStore.getState().failCompile("Network error: ECONNREFUSED");
      expect(useCompileStore.getState().error?.type).toBe("network");
      expect(useCompileStore.getState().error?.retryable).toBe(true);
    });

    it("should classify timeout errors as retryable", () => {
      useCompileStore.getState().failCompile("Request timed out after 30s");
      expect(useCompileStore.getState().error?.type).toBe("timeout");
      expect(useCompileStore.getState().error?.retryable).toBe(true);
    });

    it("should classify rate-limit errors as retryable", () => {
      useCompileStore
        .getState()
        .failCompile("Rate limit exceeded: too many requests");
      expect(useCompileStore.getState().error?.type).toBe("rate-limit");
      expect(useCompileStore.getState().error?.retryable).toBe(true);
    });

    it("should handle empty error message with fallback", () => {
      useCompileStore.getState().failCompile("");
      expect(useCompileStore.getState().message).toBe(
        "An unknown compilation error occurred.",
      );
    });

    it("should handle null/undefined error message with fallback", () => {
      useCompileStore.getState().failCompile(undefined as any);
      expect(useCompileStore.getState().message).toBe(
        "An unknown compilation error occurred.",
      );
    });

    it("should truncate extremely long error messages", () => {
      const longMsg = "x".repeat(1000);
      useCompileStore.getState().failCompile(longMsg);
      expect(useCompileStore.getState().message.length).toBeLessThanOrEqual(
        503,
      );
      expect(useCompileStore.getState().message).toMatch(/\.\.\.$/);
    });

    it("should accept explicit error type override", () => {
      useCompileStore.getState().failCompile("Custom error", "network");
      expect(useCompileStore.getState().error?.type).toBe("network");
      expect(useCompileStore.getState().error?.retryable).toBe(true);
    });

    it("should preserve progress on failure when partially complete", () => {
      useCompileStore.getState().updateProgress({ progress: 60 });
      useCompileStore.getState().failCompile("Failed at 60%");
      expect(useCompileStore.getState().progress).toBe(60);
    });
  });

  describe("reset", () => {
    it("should reset all state to defaults", () => {
      useCompileStore.getState().startCompile();
      useCompileStore
        .getState()
        .updateProgress({ progress: 50, message: "working" });
      useCompileStore.getState().failCompile("error");

      useCompileStore.getState().reset();
      const state = useCompileStore.getState();
      expect(state.isCompiling).toBe(false);
      expect(state.status).toBe("idle");
      expect(state.message).toBe("");
      expect(state.progress).toBe(0);
      expect(state.activeWorkers).toBe(0);
      expect(state.error).toBeNull();
    });
  });
});
