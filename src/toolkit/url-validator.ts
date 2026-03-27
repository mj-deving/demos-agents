/**
 * SSRF URL validator — default-deny blocklist for private/meta/local IP ranges.
 *
 * Validates URLs against resolved IP addresses (not hostname strings) to prevent
 * decimal/octal/hex encoding bypass. DNS resolution happens before request.
 *
 * Blocked by default:
 * - 0.0.0.0, localhost, 127.0.0.0/8
 * - 169.254.0.0/16 (link-local/cloud metadata)
 * - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC 1918)
 * - ::1, ::ffff:0:0/96 (IPv4-mapped IPv6)
 * - fc00::/7 (RFC 4193 ULA)
 */

import { resolve as dnsResolve } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

export interface UrlValidationOptions {
  allowInsecure?: boolean;
  /** Override DNS resolution with a specific IP (for testing) */
  resolveOverride?: string;
}

/**
 * Validate a URL against the SSRF blocklist.
 *
 * Resolves the hostname to an IP, then checks the IP against blocked ranges.
 * Returns { valid: true } or { valid: false, reason }.
 */
export async function validateUrl(
  url: string,
  opts?: UrlValidationOptions,
): Promise<UrlValidationResult> {
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  // HTTPS enforcement
  if (!opts?.allowInsecure && parsed.protocol !== "https:") {
    return { valid: false, reason: "URL must use HTTPS (set allowInsecureUrls for local dev)" };
  }

  // Resolve hostname to IP
  let resolvedIp: string;
  if (opts?.resolveOverride) {
    resolvedIp = opts.resolveOverride;
  } else {
    try {
      const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

      // If hostname is already an IP, use it directly
      if (isIPv4(hostname) || isIPv6(hostname)) {
        resolvedIp = hostname;
      } else {
        const addresses = await dnsResolve(hostname);
        if (addresses.length === 0) {
          return { valid: false, reason: `DNS resolution returned no addresses for ${hostname}` };
        }
        resolvedIp = addresses[0];
      }
    } catch (e) {
      return { valid: false, reason: `DNS resolution failed for ${parsed.hostname}: ${(e as Error).message}` };
    }
  }

  // Check resolved IP against blocklist
  const blockReason = checkBlockedIp(resolvedIp);
  if (blockReason) {
    return { valid: false, reason: blockReason, resolvedIp };
  }

  return { valid: true, resolvedIp };
}

/**
 * Create a fetch wrapper that pins DNS to a pre-resolved IP address.
 *
 * Prevents DNS rebinding attacks where an attacker's DNS returns a safe IP
 * during validateUrl() but rebinds to an internal IP (e.g., 169.254.169.254)
 * by the time fetch() actually connects.
 *
 * Strategy: rewrite the URL to use the resolved IP and set the Host header
 * to the original hostname (required for TLS SNI and virtual hosting).
 */
export function createPinnedFetch(resolvedIp: string): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? new URL(input)
      : input instanceof URL ? new URL(input.href)
      : new URL((input as Request).url);

    const originalHostname = url.hostname;

    // Rewrite hostname to resolved IP (IPv6 requires bracket notation in URL host)
    url.hostname = resolvedIp.includes(":") ? `[${resolvedIp}]` : resolvedIp;

    // Merge Host header — original hostname for TLS SNI / virtual hosting
    const headers = new Headers(init?.headers);
    if (!headers.has("host")) {
      headers.set("host", originalHostname);
    }

    return fetch(url.toString(), {
      ...init,
      headers,
    });
  };
}

/**
 * Check if an IP address falls in a blocked range.
 * Returns the block reason or null if allowed.
 */
function checkBlockedIp(ip: string): string | null {
  // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const ipv4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    const innerResult = checkBlockedIpv4(ipv4Mapped[1]);
    if (innerResult) return innerResult;
  }

  // IPv6 checks
  if (ip === "::1") {
    return "Blocked: IPv6 loopback (::1)";
  }

  // RFC 4193 Unique Local (fc00::/7)
  if (/^f[cd]/i.test(ip)) {
    return "Blocked: RFC 4193 private IPv6 range (fc00::/7)";
  }

  // IPv4 checks
  if (isIPv4(ip)) {
    return checkBlockedIpv4(ip);
  }

  return null;
}

/**
 * Check if an IPv4 address falls in a blocked range.
 */
function checkBlockedIpv4(ip: string): string | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return "Blocked: invalid IPv4 address";
  }

  const [a, b] = parts;

  // 0.0.0.0/8 ("this" network, RFC 1122)
  if (a === 0) {
    return "Blocked: 0.0.0.0/8 ('this' network)";
  }

  // 127.0.0.0/8 (loopback)
  if (a === 127) {
    return "Blocked: 127.0.0.0/8 loopback range";
  }

  // 10.0.0.0/8 (RFC 1918 private)
  if (a === 10) {
    return "Blocked: 10.0.0.0/8 private range";
  }

  // 172.16.0.0/12 (RFC 1918 private) — 172.16.0.0 to 172.31.255.255
  if (a === 172 && b >= 16 && b <= 31) {
    return "Blocked: 172.16.0.0/12 private range";
  }

  // 192.168.0.0/16 (RFC 1918 private)
  if (a === 192 && b === 168) {
    return "Blocked: 192.168.0.0/16 private range";
  }

  // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 169 && b === 254) {
    return "Blocked: 169.254.0.0/16 link-local/cloud metadata range";
  }

  // 100.64.0.0/10 (CGNAT, RFC 6598) — can reach internal services in cloud
  if (a === 100 && b >= 64 && b <= 127) {
    return "Blocked: 100.64.0.0/10 CGNAT range";
  }

  // 198.18.0.0/15 (benchmarking, RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) {
    return "Blocked: 198.18.0.0/15 benchmarking range";
  }

  // 240.0.0.0/4 (reserved, RFC 1112)
  if (a >= 240) {
    return "Blocked: 240.0.0.0/4 reserved range";
  }

  return null;
}
