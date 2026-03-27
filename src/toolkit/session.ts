/**
 * DemosSession — opaque session handle for all toolkit tool calls.
 *
 * Security properties:
 * - authToken stored via local Symbol (not globally discoverable)
 * - toJSON() redacts sensitive fields (prevents log/APM leakage)
 * - nodejs.util.inspect.custom redacts in console.log
 * - 30-min inactivity timeout
 * - NOT concurrency-safe (documented)
 */

import type { StateStore, TipPolicy, PayPolicy, ToolCallEvent, ProvenancePath } from "./types.js";
import type { SdkBridge } from "./sdk-bridge.js";

/** Typed signing handle — holds SDK instance and bridge */
export interface SigningHandle {
  demos?: unknown;
  bridge?: SdkBridge;
}

// Local Symbol — not globally discoverable via Symbol.for()
// Note: Object.getOwnPropertySymbols() can still enumerate — this prevents
// accidental leakage, not intentional extraction. See design doc Section 6.1.
const AUTH_TOKEN = Symbol("authToken");
const SIGNING_HANDLE = Symbol("signingHandle");

/** Inactivity timeout in milliseconds (30 minutes) */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export class DemosSession {
  readonly walletAddress: string;
  readonly rpcUrl: string;
  readonly algorithm: string;

  // Configuration
  readonly skillDojoFallback: boolean;
  readonly preferredPath: ProvenancePath;
  readonly stateStore: StateStore;
  readonly onToolCall?: (event: ToolCallEvent) => void;
  readonly tipPolicy: Required<TipPolicy>;
  readonly payPolicy: Required<PayPolicy>;
  readonly urlAllowlist: string[];
  readonly allowInsecureUrls: boolean;
  readonly sourceCatalogPath?: string;
  readonly specsDir?: string;
  readonly entityMaps?: {
    assets?: Record<string, string>;
    macro?: Record<string, string>;
  };

  // Internal state
  private lastActivity: number;
  private _expired: boolean = false;

  constructor(opts: {
    walletAddress: string;
    rpcUrl: string;
    algorithm: string;
    authToken: string;
    signingHandle: SigningHandle;
    skillDojoFallback?: boolean;
    preferredPath?: ProvenancePath;
    stateStore: StateStore;
    onToolCall?: (event: ToolCallEvent) => void;
    tipPolicy?: TipPolicy;
    payPolicy?: PayPolicy;
    urlAllowlist?: string[];
    allowInsecureUrls?: boolean;
    sourceCatalogPath?: string;
    specsDir?: string;
    entityMaps?: {
      assets?: Record<string, string>;
      macro?: Record<string, string>;
    };
  }) {
    this.walletAddress = opts.walletAddress;
    this.rpcUrl = opts.rpcUrl;
    this.algorithm = opts.algorithm;

    // Store sensitive data via local Symbols
    (this as Record<symbol, unknown>)[AUTH_TOKEN] = opts.authToken;
    (this as Record<symbol, unknown>)[SIGNING_HANDLE] = opts.signingHandle;

    // Configuration with defaults
    this.skillDojoFallback = opts.skillDojoFallback ?? false;
    this.preferredPath = opts.preferredPath ?? "local";
    this.stateStore = opts.stateStore;
    this.onToolCall = opts.onToolCall;
    this.tipPolicy = {
      maxPerTip: opts.tipPolicy?.maxPerTip ?? 10,
      maxPerPost: opts.tipPolicy?.maxPerPost ?? 5,
      cooldownMs: opts.tipPolicy?.cooldownMs ?? 60_000,
    };
    this.payPolicy = {
      maxPerCall: opts.payPolicy?.maxPerCall ?? 100,
      rolling24hCap: opts.payPolicy?.rolling24hCap ?? 100,
      trustedPayees: opts.payPolicy?.trustedPayees ?? [],
      requirePayeeApproval: opts.payPolicy?.requirePayeeApproval ?? true,
    };
    this.urlAllowlist = opts.urlAllowlist ?? [];
    this.allowInsecureUrls = opts.allowInsecureUrls ?? false;
    this.sourceCatalogPath = opts.sourceCatalogPath;
    this.specsDir = opts.specsDir;
    this.entityMaps = opts.entityMaps;

    this.lastActivity = Date.now();
  }

  /** Get auth token (internal use only) */
  getAuthToken(): string {
    this.checkExpired();
    return (this as Record<symbol, unknown>)[AUTH_TOKEN] as string;
  }

  /** Get signing handle (internal use only) */
  getSigningHandle(): SigningHandle {
    this.checkExpired();
    return (this as Record<symbol, unknown>)[SIGNING_HANDLE] as SigningHandle;
  }

  /** Get SDK bridge (internal use by toolkit tools) */
  getBridge(): SdkBridge {
    this.checkExpired();
    const handle = (this as Record<symbol, unknown>)[SIGNING_HANDLE] as SigningHandle | undefined;
    if (!handle?.bridge) {
      throw new Error("SDK bridge not available — session may not be fully connected");
    }
    return handle.bridge;
  }

  /** Update auth token (for refresh flows) */
  setAuthToken(token: string): void {
    this.checkExpired();
    (this as Record<symbol, unknown>)[AUTH_TOKEN] = token;
  }

  /** Record activity (resets inactivity timer) */
  touch(): void {
    this.lastActivity = Date.now();
  }

  /** Check if session has expired due to inactivity */
  get expired(): boolean {
    if (this._expired) return true;
    if (Date.now() - this.lastActivity > INACTIVITY_TIMEOUT_MS) {
      this._expired = true;
      return true;
    }
    return false;
  }

  /** Expire the session (for disconnect) */
  expire(): void {
    this._expired = true;
    // Clear sensitive data
    (this as Record<symbol, unknown>)[AUTH_TOKEN] = undefined;
    (this as Record<symbol, unknown>)[SIGNING_HANDLE] = undefined;
  }

  private checkExpired(): void {
    if (this.expired) {
      throw new Error("DemosSession expired — call connect() again");
    }
  }

  /** Redacted serialization — prevents log/APM leakage */
  toJSON(): { walletAddress: string; rpcUrl: string; algorithm: string } {
    return {
      walletAddress: this.walletAddress,
      rpcUrl: this.rpcUrl,
      algorithm: this.algorithm,
    };
  }

  /** Redacted console.log output */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `DemosSession { walletAddress: "${this.walletAddress}", rpcUrl: "${this.rpcUrl}", algorithm: "${this.algorithm}", expired: ${this.expired} }`;
  }
}
