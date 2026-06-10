import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Stage B / embedding model loads can be slow on first run.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@db": fileURLToPath(new URL("./db", import.meta.url)),
      "@evals": fileURLToPath(new URL("./evals", import.meta.url)),
    },
  },
});
