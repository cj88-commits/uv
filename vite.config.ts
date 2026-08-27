import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any path, including a GitHub Pages
// project site (https://<user>.github.io/<repo>/) without configuration.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
  },
});
