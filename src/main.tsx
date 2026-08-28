import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Per-city SEO pages inject a visually-hidden, crawler-only fallback
// heading/paragraph as a sibling of #root (see scripts/seo/generate-city-pages.mjs)
// for anything that doesn't execute JS. Once the real app has mounted, it's
// redundant -- remove it so a real browser never briefly carries two <h1>s.
// A no-op on the plain homepage, which never has this element.
document.getElementById("prerendered-seo")?.remove();
