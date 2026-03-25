export default {
  test: {
    include: ["tests/**/*.test.ts"],
    root: ".",
    globalSetup: ["tests/setup-test-quality.ts"],
  },
};
