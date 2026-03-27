/**
 * Tests for DemosSession class.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DemosSession } from "../../src/toolkit/session.js";
import type { StateStore, Unlock } from "../../src/toolkit/types.js";

function mockStateStore(): StateStore {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    lock: vi.fn(async (): Promise<Unlock> => async () => {}),
  };
}

function createSession(overrides?: Partial<ConstructorParameters<typeof DemosSession>[0]>) {
  return new DemosSession({
    walletAddress: "demos1abc123",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "secret-token-123",
    signingHandle: { privateKey: "secret" },
    stateStore: mockStateStore(),
    ...overrides,
  });
}

describe("DemosSession", () => {
  describe("toJSON redaction", () => {
    it("redacts authToken from JSON serialization", () => {
      const session = createSession();
      const json = session.toJSON();

      expect(json).toEqual({
        walletAddress: "demos1abc123",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
      });

      // Verify no sensitive fields leaked
      const jsonStr = JSON.stringify(json);
      expect(jsonStr).not.toContain("secret-token-123");
      expect(jsonStr).not.toContain("privateKey");
    });

    it("JSON.stringify uses toJSON automatically", () => {
      const session = createSession();
      const str = JSON.stringify(session);
      expect(str).not.toContain("secret-token-123");
      expect(str).not.toContain("signingHandle");
    });
  });

  describe("nodejs.util.inspect.custom redaction", () => {
    it("redacts sensitive fields in inspect output", () => {
      const session = createSession();
      const inspectFn = session[Symbol.for("nodejs.util.inspect.custom")] as () => string;
      const output = inspectFn.call(session);

      expect(output).toContain("demos1abc123");
      expect(output).toContain("falcon");
      expect(output).not.toContain("secret-token-123");
      expect(output).not.toContain("privateKey");
    });
  });

  describe("Symbol-keyed authToken", () => {
    it("authToken not accessible via normal property enumeration", () => {
      const session = createSession();
      const keys = Object.keys(session);
      expect(keys).not.toContain("authToken");

      // Not in for...in either
      const forInKeys: string[] = [];
      for (const key in session) {
        forInKeys.push(key);
      }
      expect(forInKeys).not.toContain("authToken");
    });

    it("authToken accessible via getAuthToken method", () => {
      const session = createSession();
      expect(session.getAuthToken()).toBe("secret-token-123");
    });

    it("signingHandle accessible via getSigningHandle method", () => {
      const session = createSession();
      expect(session.getSigningHandle()).toEqual({ privateKey: "secret" });
    });

    it("authToken can be updated via setAuthToken", () => {
      const session = createSession();
      session.setAuthToken("new-token-456");
      expect(session.getAuthToken()).toBe("new-token-456");
    });
  });

  describe("readonly properties", () => {
    it("walletAddress, rpcUrl, algorithm are readonly", () => {
      const session = createSession();
      expect(session.walletAddress).toBe("demos1abc123");
      expect(session.rpcUrl).toBe("https://demosnode.discus.sh");
      expect(session.algorithm).toBe("falcon");
    });
  });

  describe("session expiry", () => {
    it("disconnect expires the session", () => {
      const session = createSession();
      expect(session.expired).toBe(false);

      session.expire();
      expect(session.expired).toBe(true);
    });

    it("expired session throws on getAuthToken", () => {
      const session = createSession();
      session.expire();

      expect(() => session.getAuthToken()).toThrow("DemosSession expired");
    });

    it("expired session throws on getSigningHandle", () => {
      const session = createSession();
      session.expire();

      expect(() => session.getSigningHandle()).toThrow("DemosSession expired");
    });

    it("expire clears sensitive data", () => {
      const session = createSession();
      session.expire();

      // Verify symbols are cleared (accessing should throw due to expired check)
      expect(() => session.getAuthToken()).toThrow();
    });
  });

  describe("inactivity tracking", () => {
    it("touch() resets activity timer", () => {
      const session = createSession();
      session.touch();
      expect(session.expired).toBe(false);
    });
  });

  describe("default policy values", () => {
    it("tip policy defaults to 10/5/60000", () => {
      const session = createSession();
      expect(session.tipPolicy.maxPerTip).toBe(10);
      expect(session.tipPolicy.maxPerPost).toBe(5);
      expect(session.tipPolicy.cooldownMs).toBe(60000);
    });

    it("pay policy defaults to 100/100/[]/false", () => {
      const session = createSession();
      expect(session.payPolicy.maxPerCall).toBe(100);
      expect(session.payPolicy.rolling24hCap).toBe(100);
      expect(session.payPolicy.trustedPayees).toEqual([]);
      expect(session.payPolicy.requirePayeeApproval).toBe(false);
    });

    it("custom policies override defaults", () => {
      const session = createSession({
        tipPolicy: { maxPerTip: 5 },
        payPolicy: { rolling24hCap: 50 },
      });
      expect(session.tipPolicy.maxPerTip).toBe(5);
      expect(session.tipPolicy.maxPerPost).toBe(5); // default kept
      expect(session.payPolicy.rolling24hCap).toBe(50);
    });
  });
});
