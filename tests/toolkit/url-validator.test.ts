/**
 * Tests for SSRF URL validator.
 *
 * Verifies default-deny blocklist for private/meta/local IP ranges,
 * HTTPS enforcement, and allowlist overrides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateUrl } from "../../src/toolkit/url-validator.js";

describe("URL Validator — SSRF Protection", () => {
  describe("HTTPS enforcement", () => {
    it("rejects HTTP URLs by default", async () => {
      const result = await validateUrl("http://example.com/api");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("HTTPS");
    });

    it("allows HTTPS URLs", async () => {
      const result = await validateUrl("https://example.com/api");
      expect(result.valid).toBe(true);
    });

    it("allows HTTP when allowInsecure is true", async () => {
      const result = await validateUrl("http://example.com/api", { allowInsecure: true });
      expect(result.valid).toBe(true);
    });
  });

  describe("RFC 1918 private ranges", () => {
    it("blocks 10.0.0.0/8", async () => {
      const result = await validateUrl("https://10.0.0.1/api", { resolveOverride: "10.0.0.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("private");
    });

    it("blocks 172.16.0.0/12", async () => {
      const result = await validateUrl("https://172.16.0.1/api", { resolveOverride: "172.16.0.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("private");
    });

    it("blocks 172.31.255.255 (upper end of 172.16/12)", async () => {
      const result = await validateUrl("https://172.31.255.255/api", { resolveOverride: "172.31.255.255" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("private");
    });

    it("allows 172.32.0.1 (outside 172.16/12)", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "172.32.0.1" });
      expect(result.valid).toBe(true);
    });

    it("blocks 192.168.0.0/16", async () => {
      const result = await validateUrl("https://192.168.1.1/api", { resolveOverride: "192.168.1.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("private");
    });
  });

  describe("localhost and loopback", () => {
    it("blocks 127.0.0.1", async () => {
      const result = await validateUrl("https://127.0.0.1/api", { resolveOverride: "127.0.0.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("loopback");
    });

    it("blocks 127.0.0.0/8 range", async () => {
      const result = await validateUrl("https://127.255.255.255/api", { resolveOverride: "127.255.255.255" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("loopback");
    });

    it("blocks 0.0.0.0", async () => {
      const result = await validateUrl("https://0.0.0.0/api", { resolveOverride: "0.0.0.0" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("blocked");
    });
  });

  describe("link-local / cloud metadata", () => {
    it("blocks 169.254.0.0/16 (link-local / cloud metadata)", async () => {
      const result = await validateUrl("https://169.254.169.254/latest/meta-data", { resolveOverride: "169.254.169.254" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("metadata");
    });
  });

  describe("IPv6", () => {
    it("blocks ::1 (IPv6 loopback)", async () => {
      const result = await validateUrl("https://[::1]/api", { resolveOverride: "::1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("loopback");
    });

    it("blocks ::ffff:127.0.0.1 (IPv4-mapped IPv6)", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "::ffff:127.0.0.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("loopback");
    });

    it("blocks ::ffff:10.0.0.1 (IPv4-mapped private)", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "::ffff:10.0.0.1" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("private");
    });

    it("blocks ::ffff:169.254.169.254 (IPv4-mapped metadata)", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "::ffff:169.254.169.254" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("metadata");
    });
  });

  describe("valid public IPs", () => {
    it("allows public IPv4", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "93.184.216.34" });
      expect(result.valid).toBe(true);
    });

    it("allows public IPv6", async () => {
      const result = await validateUrl("https://example.com/api", { resolveOverride: "2606:2800:220:1:248:1893:25c8:1946" });
      expect(result.valid).toBe(true);
    });
  });

  describe("malformed input", () => {
    it("rejects empty URL", async () => {
      const result = await validateUrl("");
      expect(result.valid).toBe(false);
    });

    it("rejects non-URL string", async () => {
      const result = await validateUrl("not a url");
      expect(result.valid).toBe(false);
    });
  });
});
