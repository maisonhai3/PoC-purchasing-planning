import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Capture unhandled errors and promise rejections.
// Firebase Crashlytics web SDK (beta) logs these automatically once
// initialized. Until the web SDK stabilises, errors are also captured
// via Analytics error_occurred events and the Function's audit log.
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});

window.addEventListener("error", (event) => {
  console.error("Unhandled error:", event.error);
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
