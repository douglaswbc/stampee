import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Recover once when a cached app version references chunks removed by a newer deployment.
const PRELOAD_RECOVERY_KEY = 'stampfy_preload_recovery_at';
const PRELOAD_RECOVERY_COOLDOWN_MS = 30_000;

window.addEventListener('vite:preloadError', (event) => {
  try {
    const lastRecoveryAt = Number(window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY));
    if (lastRecoveryAt && Date.now() - lastRecoveryAt < PRELOAD_RECOVERY_COOLDOWN_MS) return;
    window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(Date.now()));
  } catch {
    // Leave the import error visible if the browser does not allow session storage.
    return;
  }

  event.preventDefault();
  window.location.reload();
});

// Keep the app installable. The worker caches only static assets and the generic
// HTML shell; API responses and customer-specific routes are always network-only.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {
        // A service worker is an enhancement; it must not block the web app.
      });
  }, { once: true });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
