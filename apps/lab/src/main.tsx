import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

performance.mark("lab-start");

const root = document.getElementById("root");
if (!root) throw new Error("The lab needs a #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
