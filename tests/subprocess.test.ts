/**
 * Tests for tools/lib/subprocess.ts — subprocess runner for session tools.
 *
 * Tests runTool() spawning, exit code handling, timeout behavior,
 * ToolError properties, and custom env passthrough.
 */

import { describe, it, expect } from "vitest";
import { runTool, ToolError } from "../tools/lib/subprocess.js";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Helper: write a temporary .ts script, return its absolute path
function writeTempScript(name: string, code: string): string {
  const dir = mkdtempSync(join(tmpdir(), "subprocess-test-"));
  const path = join(dir, name);
  writeFileSync(path, code, "utf-8");
  return path;
}

describe("subprocess — runTool", () => {
  it("returns stdout, stderr, and exitCode 0 on success", async () => {
    const script = writeTempScript("ok.ts", `
      process.stdout.write('{"result":"ok"}');
      process.stderr.write('debug info');
    `);

    const result = await runTool(script, [], { timeout: 15_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"result":"ok"}');
    expect(result.stderr).toBe("debug info");

    unlinkSync(script);
  });

  it("throws ToolError with exitCode and stderr on non-zero exit", async () => {
    const script = writeTempScript("fail.ts", `
      process.stderr.write('something went wrong\\n');
      process.exit(42);
    `);

    try {
      await runTool(script, [], { timeout: 15_000 });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const te = err as ToolError;
      expect(te.exitCode).toBe(42);
      expect(te.stderr).toContain("something went wrong");
      expect(te.name).toBe("ToolError");
    }

    unlinkSync(script);
  });

  it("throws ToolError with exitCode -1 on timeout", async () => {
    const script = writeTempScript("hang.ts", `
      // Sleep indefinitely
      setTimeout(() => {}, 999_999);
    `);

    try {
      await runTool(script, [], { timeout: 500 });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const te = err as ToolError;
      expect(te.exitCode).toBe(-1);
      expect(te.stderr).toContain("Timed out");
    }

    unlinkSync(script);
  }, 15_000); // generous outer timeout for CI

  it("passes custom env vars to subprocess", async () => {
    const script = writeTempScript("env.ts", `
      process.stdout.write(process.env.TEST_CUSTOM_VAR ?? "MISSING");
    `);

    const result = await runTool(script, [], {
      timeout: 15_000,
      env: { TEST_CUSTOM_VAR: "hello-from-test" },
    });

    expect(result.stdout).toBe("hello-from-test");

    unlinkSync(script);
  });

  it("passes CLI args to subprocess", async () => {
    const script = writeTempScript("args.ts", `
      process.stdout.write(JSON.stringify(process.argv.slice(2)));
    `);

    const result = await runTool(script, ["--foo", "bar"], { timeout: 15_000 });

    expect(JSON.parse(result.stdout)).toEqual(["--foo", "bar"]);

    unlinkSync(script);
  });
});

describe("subprocess — ToolError", () => {
  it("has correct properties", () => {
    const err = new ToolError("tools/audit.ts", 1, "bad input\nfatal error");
    expect(err.name).toBe("ToolError");
    expect(err.exitCode).toBe(1);
    expect(err.stderr).toBe("bad input\nfatal error");
    // message uses last line of stderr
    expect(err.message).toContain("fatal error");
    expect(err.message).toContain("tools/audit.ts");
    expect(err).toBeInstanceOf(Error);
  });

  it("handles empty stderr gracefully", () => {
    const err = new ToolError("tools/gate.ts", 2, "");
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain("unknown error");
  });
});
