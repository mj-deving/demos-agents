import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "omniweb-toolkit/agent": resolve(__dirname, "packages/omniweb-toolkit/src/agent.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    root: ".",
    globalSetup: ["tests/setup-test-quality.ts"],
  },
});
