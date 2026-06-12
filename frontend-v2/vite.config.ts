import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Served from the root of loadleadapp.com in production
  base: "/",

  server: {
    host: "::",
    port: 3001,
    hmr: { overlay: false },
    // Dev-only proxy — in production VITE_API_URL=https://api.loadleadapp.com
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: false,
  },

  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
