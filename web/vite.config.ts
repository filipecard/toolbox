import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs in `wrangler dev` (port 8787); proxying keeps
// site and API on one origin, like production (one Worker serves both).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
