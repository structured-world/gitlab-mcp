/**
 * Unit tests for InstanceRateLimiter
 * Tests per-instance rate limiting with request queuing
 */

import {
  InstanceRateLimiter,
  DEFAULT_RATE_LIMIT_CONFIG,
} from "../../../src/services/InstanceRateLimiter";

describe("InstanceRateLimiter", () => {
  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      const limiter = new InstanceRateLimiter();
      const config = limiter.getConfig();

      expect(config.maxConcurrent).toBe(DEFAULT_RATE_LIMIT_CONFIG.maxConcurrent);
      expect(config.queueSize).toBe(DEFAULT_RATE_LIMIT_CONFIG.queueSize);
      expect(config.queueTimeout).toBe(DEFAULT_RATE_LIMIT_CONFIG.queueTimeout);
    });

    it("should use provided config", () => {
      const customConfig = {
        maxConcurrent: 10,
        queueSize: 50,
        queueTimeout: 5000,
      };
      const limiter = new InstanceRateLimiter(customConfig);
      const config = limiter.getConfig();

      expect(config.maxConcurrent).toBe(10);
      expect(config.queueSize).toBe(50);
      expect(config.queueTimeout).toBe(5000);
    });

    it("should merge partial config with defaults", () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 5 });
      const config = limiter.getConfig();

      expect(config.maxConcurrent).toBe(5);
      expect(config.queueSize).toBe(DEFAULT_RATE_LIMIT_CONFIG.queueSize);
      expect(config.queueTimeout).toBe(DEFAULT_RATE_LIMIT_CONFIG.queueTimeout);
    });
  });

  describe("acquire", () => {
    it("should acquire slot immediately when under limit", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 2 });

      const release1 = await limiter.acquire();
      const release2 = await limiter.acquire();

      const metrics = limiter.getMetrics();
      expect(metrics.activeRequests).toBe(2);
      expect(metrics.queuedRequests).toBe(0);

      release1();
      release2();
    });

    it("should track total requests", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 5 });

      const release1 = await limiter.acquire();
      const release2 = await limiter.acquire();
      const release3 = await limiter.acquire();

      const metrics = limiter.getMetrics();
      expect(metrics.requestsTotal).toBe(3);

      release1();
      release2();
      release3();
    });

    it("should release slot when release function is called", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 1 });

      const release = await limiter.acquire();
      expect(limiter.getMetrics().activeRequests).toBe(1);

      release();
      expect(limiter.getMetrics().activeRequests).toBe(0);
    });
  });

  describe("queuing", () => {
    it("should queue requests when at capacity", async () => {
      const limiter = new InstanceRateLimiter({
        maxConcurrent: 1,
        queueSize: 10,
        queueTimeout: 5000,
      });

      // Acquire first slot
      const release1 = await limiter.acquire();

      // Second acquire should be queued
      const acquirePromise = limiter.acquire();

      // Give it a tick to queue
      await new Promise(resolve => setTimeout(resolve, 0));

      const metrics = limiter.getMetrics();
      expect(metrics.activeRequests).toBe(1);
      expect(metrics.queuedRequests).toBe(1);
      expect(metrics.requestsQueued).toBe(1);

      // Release first slot - should process queued request
      release1();

      const release2 = await acquirePromise;
      expect(limiter.getMetrics().activeRequests).toBe(1);
      expect(limiter.getMetrics().queuedRequests).toBe(0);

      release2();
    });

    it("should reject when queue is full", async () => {
      const limiter = new InstanceRateLimiter({
        maxConcurrent: 1,
        queueSize: 1,
        queueTimeout: 5000,
      });

      // Acquire slot
      const release = await limiter.acquire();

      // Queue one request
      const queuedPromise = limiter.acquire();
      await new Promise(resolve => setTimeout(resolve));

      // Third request should be rejected (queue is full)
      await expect(limiter.acquire()).rejects.toThrow(/Rate limit exceeded/);

      const metrics = limiter.getMetrics();
      expect(metrics.requestsRejected).toBe(1);

      // Cleanup
      release();
      const release2 = await queuedPromise;
      release2();
    });
  });

  describe("getMetrics", () => {
    it("should return correct initial metrics", () => {
      const limiter = new InstanceRateLimiter({
        maxConcurrent: 50,
        queueSize: 100,
      });

      const metrics = limiter.getMetrics();

      expect(metrics.activeRequests).toBe(0);
      expect(metrics.maxConcurrent).toBe(50);
      expect(metrics.queuedRequests).toBe(0);
      expect(metrics.queueSize).toBe(100);
      expect(metrics.requestsTotal).toBe(0);
      expect(metrics.requestsQueued).toBe(0);
      expect(metrics.requestsRejected).toBe(0);
      expect(metrics.avgQueueWaitMs).toBe(0);
    });
  });

  describe("isAtCapacity", () => {
    it("should return false when under capacity", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 2 });

      expect(limiter.isAtCapacity()).toBe(false);

      const release = await limiter.acquire();
      expect(limiter.isAtCapacity()).toBe(false);

      release();
    });

    it("should return true when at capacity", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 1 });

      const release = await limiter.acquire();
      expect(limiter.isAtCapacity()).toBe(true);

      release();
      expect(limiter.isAtCapacity()).toBe(false);
    });
  });

  describe("isQueueFull", () => {
    it("should return false when queue is not full", async () => {
      const limiter = new InstanceRateLimiter({
        maxConcurrent: 1,
        queueSize: 2,
      });

      const release = await limiter.acquire();
      expect(limiter.isQueueFull()).toBe(false);

      release();
    });

    it("should return true when queue is full", async () => {
      const limiter = new InstanceRateLimiter({
        maxConcurrent: 1,
        queueSize: 1,
        queueTimeout: 5000,
      });

      const release = await limiter.acquire();
      const queuedPromise = limiter.acquire();
      await new Promise(resolve => setTimeout(resolve));

      expect(limiter.isQueueFull()).toBe(true);

      release();
      const release2 = await queuedPromise;
      release2();
    });
  });

  describe("resetMetrics", () => {
    it("should reset all counter metrics", async () => {
      const limiter = new InstanceRateLimiter({ maxConcurrent: 5 });

      // Generate some metrics
      const release = await limiter.acquire();
      release();

      expect(limiter.getMetrics().requestsTotal).toBe(1);

      limiter.resetMetrics();

      const metrics = limiter.getMetrics();
      expect(metrics.requestsTotal).toBe(0);
      expect(metrics.requestsQueued).toBe(0);
      expect(metrics.requestsRejected).toBe(0);
      expect(metrics.avgQueueWaitMs).toBe(0);
    });
  });
});
