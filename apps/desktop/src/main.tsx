import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/caveat/500.css";
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
