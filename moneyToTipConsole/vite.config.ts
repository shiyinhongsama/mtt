import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 管理端：生产构建挂在服务端 /console/（见 moneyToTip 的 mtt/main.py）；
// 开发服务器把 /api 代理到 FastAPI（mtt serve）。
export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  preview: {
    port: 8002,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
