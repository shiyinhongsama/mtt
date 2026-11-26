import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Node 25+ 默认启用内置 Web Storage，全局 localStorage 不再来自 jsdom
const nodeMajor = Number(process.versions.node.split(".")[0]);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    poolOptions: { forks: { execArgv: nodeMajor >= 25 ? ["--no-experimental-webstorage"] : [] } },
  },
});
