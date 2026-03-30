import { resolve } from "node:path";

export default {
  test: {
    include: ["tests/**/*.test.ts"],
    root: ".",
    globalSetup: ["tests/setup-test-quality.ts"],
  },
  resolve: {
    alias: {
      "@demos-agents/core/supercolony/scoring": resolve(
        __dirname,
        "packages/core/src/supercolony/scoring.ts"
      ),
      "@demos-agents/core": resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
};
