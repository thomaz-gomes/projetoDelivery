import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "../delivery-saas-backend/ssl/localhost-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "../delivery-saas-backend/ssl/localhost.pem")),
    },
    host: "localhost",
    port: 5173,
  },
});