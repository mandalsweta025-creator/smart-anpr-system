import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { ToastProvider } from "./components/Toast";

// Apply saved theme before first render to avoid flash
if (localStorage.getItem("anpr_theme") === "light") {
  document.documentElement.classList.add("light-mode");
}

import "./styles/nexus.css";
import "./styles/portal.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);