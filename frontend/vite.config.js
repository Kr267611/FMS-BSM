import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// `npm run preview` sends the same security headers (CSP…) as the live site on Vercel, so a page that the
// CSP would break shows up here first. Taken from vercel.json, so there is one list to keep.
const siteHeaders = () => {
  try {
    const rule = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).headers.find((h) => h.source === "/((?!api/).*)");
    return Object.fromEntries(rule.headers.filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.value]));
  } catch {
    return {};
  }
};

// Port 5180 - inventory app (3000) se alag
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": "http://localhost:5050" },
  },
  preview: {
    headers: siteHeaders(),
    proxy: { "/api": "http://localhost:5050" },
  },
});
