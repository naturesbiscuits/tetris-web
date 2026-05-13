import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules") && id.includes("phaser")) {
            return "phaser";
          }
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 5173
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173
  }
});
