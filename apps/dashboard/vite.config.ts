import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "");
  const frontendCommandTimeoutMs = Number(rootEnv.FRONTEND_COMMAND_TIMEOUT_MS) || 300_000;
  return {
    plugins: [react()],
    define: { __FRONTEND_COMMAND_TIMEOUT_MS__: JSON.stringify(frontendCommandTimeoutMs) },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
    },
  };
});
