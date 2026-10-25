import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { emptyOutDir: false },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    watch: { ignored: ["**/.runtime/**", "**/docs/**"] },
    proxy: { "/api": process.env.SORTY_API_URL || "http://127.0.0.1:3001" },
  },
});
