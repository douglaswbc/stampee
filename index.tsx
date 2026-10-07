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

// Ensure no stale service worker is serving cached assets.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  }).catch(() => {
    // No-op: failure to unregister should not break app startup.
  });
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
