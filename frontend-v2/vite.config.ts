import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Two build targets:
//   default          -> dist/        (customer surface, served on loadleadapp.com)
//   LL_BUILD=admin   -> dist-admin/  (admin-only surface, served on admin.loadleadapp.com)
// Both bundles ship from the same source tree, but the admin entry only
// imports /admin and the login screen. See admin-main.tsx.
const isAdmin = process.env.LL_BUILD === "admin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Served from the root of (admin.)loadleadapp.com in production
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
    outDir: isAdmin ? "dist-admin" : "dist",
    sourcemap: false,
    rollupOptions: isAdmin
      ? { input: path.resolve(__dirname, "admin.html") }
      : undefined,
  },

  define: {
    "import.meta.env.LL_ADMIN_BUILD": JSON.stringify(isAdmin),
  },

  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
