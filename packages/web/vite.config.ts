import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const WEB_PORT = Number(process.env.WEB_PORT) || 5180;
const API_PORT = Number(process.env.PORT) || 3009;
const apiTarget = `http://localhost:${API_PORT}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: WEB_PORT,
    proxy: {
      "/projects": apiTarget,
      "/tasks": apiTarget,
      "/agent": apiTarget,
      "/settings": apiTarget,
      "/health": apiTarget,
      "/ws": {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
      },
    },
  },
});
