import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// 生产构建挂在服务端 /app/ 路径下（见 mtt/main.py）；
// 开发服务器把 /api 代理到 FastAPI（mtt serve）。
export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "忙里偷题",
        short_name: "忙里偷题",
        description: "Small tips, big steps.",
        lang: "zh-CN",
        start_url: "/app/",
        scope: "/app/",
        display: "standalone",
        background_color: "#F4F1EA",
        theme_color: "#F4F1EA",
        icons: [
          { src: "/app/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/app/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/app/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/app/index.html",
        runtimeCaching: [
          {
            // API 永远走网络（判定与排期以服务端为唯一事实源）
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
          {
            // Google Fonts 缓存优先，弱网不白屏
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": process.env.MTT_API_ORIGIN ?? "http://127.0.0.1:8000" },
  },
  preview: {
    port: 8001,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
