import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the build works from any path -- both a GitHub Pages
// project site served from a subpath (https://<user>.github.io/<repo>/)
// and the custom domain (https://spfyesorno.com/, served from root) resolve
// asset URLs correctly with no base-path change needed between the two.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
  },
});
