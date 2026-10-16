import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

// Tauri expects a fixed port and doesn't want Vite to clear its output.
export default defineConfig({
  plugins: [react()],
  // The version shown in Settings and compared by the auto-updater.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2022" },
  test: { environment: "node" },
});
