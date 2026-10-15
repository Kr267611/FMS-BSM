import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

// Installable app (Android, iPhone, desktop): register the service worker in the built app only
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// No pinch zoom on iPhone / iPad: Safari ignores user-scalable=no in the viewport tag, so its pinch gesture is
// stopped here (Android follows the tag; double-tap zoom is off by touch-action in styles.css)
if ("ongesturestart" in window && navigator.maxTouchPoints > 0) {
  const stop = (e: Event) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, stop, { passive: false });
  document.addEventListener("touchmove", (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
