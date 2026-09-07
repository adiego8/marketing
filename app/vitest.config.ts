import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Scoped to the planner's pure functions. Gap arithmetic, week boundaries and
// date assignment are where a subtle bug produces a plausible-looking but wrong
// calendar — DST drift, an ISO year with 53 weeks, posts landing on a weekend.
// None of that is visible in a manual read of the output.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
