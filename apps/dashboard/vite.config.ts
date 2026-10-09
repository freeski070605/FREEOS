import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const rootEnv = loadEnv(mode, repoRoot, "");
  const frontendCommandTimeoutMs = Number(rootEnv.FRONTEND_COMMAND_TIMEOUT_MS) || 300_000;
  const remoteMode = mode === "remote";
  const host = remoteMode ? (rootEnv.REMOTE_OPS_HOST?.trim() || "127.0.0.1") : "127.0.0.1";
  const apiBase = remoteMode ? "/api" : (rootEnv.VITE_API_BASE_URL?.trim() || "http://localhost:3001");
  return {
    plugins: [react()],
    define: {
      __FRONTEND_COMMAND_TIMEOUT_MS__: JSON.stringify(frontendCommandTimeoutMs),
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBase),
    },
    server: {
      host,
      port: 5173,
      strictPort: true,
      proxy: remoteMode ? {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      } : undefined,
    },
  };
});
