import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PrPage from "./components/trust/PrPage";
import "./style.css";

// /pr/<slug> is the live review page for one pull request; everything else is Studio.
const prSlug = /^\/pr\/([a-z0-9]+)\/?$/i.exec(location.pathname)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {prSlug ? <PrPage slug={prSlug} /> : <App />}
  </StrictMode>,
);
