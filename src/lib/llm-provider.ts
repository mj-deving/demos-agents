/**
 * Provider-agnostic LLM abstraction.
 *
 * Every LLM is just prompt → text. This module provides a minimal interface
 * and a resolution function that discovers the best available provider from
 * the environment — explicit config first, then CLI autodetect.
 *
 * Resolution order (explicit-first, CLI-preferred):
 *   1. LLM_PROVIDER env var → use that adapter
 *   2. LLM_CLI_COMMAND env var → CLIProvider
 *   3. ANTHROPIC_API_KEY alone → AnthropicProvider
 *   4. OPENAI_API_KEY alone → OpenAIProvider
 *   5. Multiple keys without LLM_PROVIDER → error
 *   6. CLI autodetect (which codex/claude/ollama)
 *   7. Nothing → null
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ── Interface ─────────────────────────────────────

export interface LLMProvider {
  /** The only method — every LLM is just prompt→text */
  complete(prompt: string, options?: {
    system?: string;
    maxTokens?: number;
    model?: string;
    modelTier?: "fast" | "standard" | "premium";
  }): Promise<string>;

  /** Human-readable name for logging ("anthropic", "codex-cli", "ollama") */
  readonly name: string;
}

// ── CLI Provider ──────────────────────────────────

/**
 * Subprocess adapter for any CLI that accepts a prompt on stdin.
 * Covers: codex exec, claude --print, ollama run, or any custom LLM_CLI_COMMAND.
 * Handles its own auth (OAuth, local, whatever).
 *
 * Contract: prompt is delivered via stdin pipe (no shell, no temp files).
 * The command string is the full command WITHOUT a prompt argument.
 * Example: "claude --print", "ollama run llama3", "codex exec --full-auto -q"
 *
 * Security: command is split into executable + args and spawned directly
 * via spawn() without a shell, preventing shell injection from env vars.
 */
export class CLIProvider implements LLMProvider {
  readonly name: string;
  private executable: string;
  private args: string[];

  constructor(command: string, name?: string) {
    const parts = command.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      throw new Error("CLIProvider: command string cannot be empty");
    }
    this.executable = parts[0];
    this.args = parts.slice(1);
    this.name = name || `cli:${this.executable}`;
  }

  async complete(prompt: string, options?: { system?: string; maxTokens?: number; modelTier?: "fast" | "standard" | "premium" }): Promise<string> {
    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    // Pipe prompt directly via stdin — no shell, no temp files.
    // spawn() without shell prevents command injection from env vars.
    // Pass modelTier as LLM_MODEL_TIER env var so CLI tools can use it.
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(this.executable, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
        env: {
          ...process.env,
          ...(options?.modelTier ? { LLM_MODEL_TIER: options.modelTier } : {}),
        },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      // Write prompt to stdin and close it so the CLI knows input is complete
      child.stdin.write(fullPrompt);
      child.stdin.end();

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`CLI provider "${this.name}" exited with code ${code}: ${(stderr || stdout).slice(0, 500)}`));
        } else {
          const result = stdout.trim();
          if (!result) {
            reject(new Error(`CLI provider "${this.name}" returned empty output. Does the command read from stdin?`));
          } else {
            resolvePromise(result);
          }
        }
      });

      child.on("error", (err) => {
        reject(new Error(`CLI provider "${this.name}" failed to spawn: ${err.message}`));
      });
    });
  }
}

// ── Anthropic Provider ────────────────────────────

/**
 * Wraps @anthropic-ai/sdk. Activated by ANTHROPIC_API_KEY.
 * Uses dynamic import so the SDK is optional.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private envPath?: string;

  constructor(apiKey: string, envPath?: string) {
    this.apiKey = apiKey;
    this.envPath = envPath;
  }

  async complete(
    prompt: string,
    options?: { system?: string; maxTokens?: number; model?: string; modelTier?: "fast" | "standard" | "premium" }
  ): Promise<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const model = resolveModel(options, this.envPath);

    const response = await client.messages.create({
      model,
      max_tokens: options?.maxTokens || 1024,
      messages: [{ role: "user", content: prompt }],
      ...(options?.system ? { system: options.system } : {}),
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Anthropic returned non-text response");
    }
    return content.text;
  }
}

// ── OpenAI Provider ───────────────────────────────

/**
 * Wraps openai SDK. Activated by OPENAI_API_KEY.
 * Uses dynamic import so the SDK is optional.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private apiKey: string;
  private envPath?: string;

  constructor(apiKey: string, envPath?: string) {
    this.apiKey = apiKey;
    this.envPath = envPath;
  }

  async complete(
    prompt: string,
    options?: { system?: string; maxTokens?: number; model?: string; modelTier?: "fast" | "standard" | "premium" }
  ): Promise<string> {
    // Dynamic import — openai is an optional dependency
    // Use string variable to prevent tsc from resolving the module at compile time
    const pkg = "openai";
    let OpenAI: any;
    try {
      OpenAI = (await import(/* webpackIgnore: true */ pkg)).default;
    } catch {
      throw new Error("openai package not installed. Run: npm install openai");
    }
    const client = new OpenAI({ apiKey: this.apiKey });

    const messages: Array<{ role: string; content: string }> = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    const response = await client.chat.completions.create({
      model: resolveModel(options, this.envPath),
      max_tokens: options?.maxTokens || 1024,
      messages,
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("OpenAI returned empty response");
    }
    return text;
  }
}

// ── Resolution ────────────────────────────────────

/** Check if a CLI command is available on PATH */
function whichSync(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Load an API key from env or .env file */
function loadKeyFromEnv(key: string, envPath?: string): string | undefined {
  if (process.env[key]) return process.env[key];

  if (envPath) {
    try {
      const resolved = resolve(envPath.replace(/^~/, homedir()));
      if (existsSync(resolved)) {
        const content = readFileSync(resolved, "utf-8");
        const match = content.match(new RegExp(`${key}="?([^"\\n]+)"?`));
        if (match) return match[1];
      }
    } catch { /* non-fatal */ }
  }

  return undefined;
}

function resolveModel(
  options?: { model?: string; modelTier?: "fast" | "standard" | "premium" },
  envPath?: string
): string {
  if (options?.model && options.model.trim()) return options.model.trim();

  const tier = options?.modelTier || "standard";
  const key = tier === "fast"
    ? "LLM_MODEL_FAST"
    : tier === "premium"
      ? "LLM_MODEL_PREMIUM"
      : "LLM_MODEL_STANDARD";

  const model = loadKeyFromEnv(key, envPath);
  if (!model) {
    throw new Error(
      `${key} not found. Set ${key} in environment or .env (tiers: fast/standard/premium).`
    );
  }
  return model;
}

/**
 * Resolve the best available LLM provider from the environment.
 * Returns null if no LLM is available (callers must handle gracefully).
 */
export function resolveProvider(envPath?: string): LLMProvider | null {
  // Step 1: Explicit LLM_PROVIDER (process.env or .env file)
  const explicitProvider = loadKeyFromEnv("LLM_PROVIDER", envPath);
  if (explicitProvider) {
    switch (explicitProvider.toLowerCase()) {
      case "anthropic": {
        const key = loadKeyFromEnv("ANTHROPIC_API_KEY", envPath);
        if (!key) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY not found");
        return new AnthropicProvider(key, envPath);
      }
      case "openai": {
        const key = loadKeyFromEnv("OPENAI_API_KEY", envPath);
        if (!key) throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY not found");
        return new OpenAIProvider(key, envPath);
      }
      case "cli": {
        const cmd = loadKeyFromEnv("LLM_CLI_COMMAND", envPath);
        if (!cmd) throw new Error("LLM_PROVIDER=cli but LLM_CLI_COMMAND not set");
        return new CLIProvider(cmd);
      }
      default:
        throw new Error(`Unknown LLM_PROVIDER="${explicitProvider}". Valid: anthropic, openai, cli`);
    }
  }

  // Step 2: LLM_CLI_COMMAND (process.env or .env file)
  const cliCommand = loadKeyFromEnv("LLM_CLI_COMMAND", envPath);
  if (cliCommand) {
    return new CLIProvider(cliCommand);
  }

  // Steps 3-5: API key detection
  const anthropicKey = loadKeyFromEnv("ANTHROPIC_API_KEY", envPath);
  const openaiKey = loadKeyFromEnv("OPENAI_API_KEY", envPath);

  if (anthropicKey && openaiKey) {
    // Step 5: Multiple keys — error
    throw new Error(
      "Multiple LLM credentials found (ANTHROPIC_API_KEY + OPENAI_API_KEY). " +
      "Set LLM_PROVIDER=anthropic|openai|cli to disambiguate."
    );
  }
  if (anthropicKey) return new AnthropicProvider(anthropicKey, envPath);
  if (openaiKey) return new OpenAIProvider(openaiKey, envPath);

  // Step 6: CLI autodetect
  if (whichSync("codex")) {
    return new CLIProvider("codex exec --full-auto", "cli:codex");
  }
  if (whichSync("claude")) {
    return new CLIProvider("claude --print", "cli:claude");
  }
  if (whichSync("ollama")) {
    return new CLIProvider("ollama run llama3", "cli:ollama");
  }

  // Step 7: Nothing
  return null;
}
