import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Absolute root base. The site now has a fixed custom domain
// (https://spfyesorno.com/, served from root -- see public/CNAME), and
// per-city SEO pages (dist/<slug>/index.html, one directory deep) need
// asset/data URLs that resolve correctly regardless of page depth. A
// relative base ("./") would resolve "./assets/..." from /london/ as
// /london/assets/..., which doesn't exist -- only /assets/... does, since
// every page shares one built bundle. src/lib/forecast.ts's and
// landMask.ts's data-fetch defaults were changed to match (see "/data/").
export default defineConfig({
  base: "/",
  plugins: [react()],
  test: {
    environment: "node",
  },
});
