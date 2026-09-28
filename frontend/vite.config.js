import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 5180 - inventory app (3000) se alag
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": "http://localhost:5050" },
  },
});
