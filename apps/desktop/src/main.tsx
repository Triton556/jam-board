import "@fontsource-variable/jetbrains-mono";
import "@fontsource/pt-serif/400.css";
import "@fontsource/pt-serif/400-italic.css";
import "@fontsource/pt-serif/700.css";
import "@fontsource/pt-serif/700-italic.css";
import "@fontsource-variable/shantell-sans/wght.css";
import "@fontsource-variable/shantell-sans/wght-italic.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

import "./styles/m5.css";
import "./styles/v22.css";

import "./styles/v24b.css";
import "./styles/agent-working.css";
import "./styles/workflow.css";
import "./styles/type-fit.css";
