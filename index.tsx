import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { isPublicCardPath, startInstallPromptCapture } from './lib/card/installPrompt';

const SW_URL = '/sw.js';
const onPublicCard = isPublicCardPath(window.location.pathname);

if ('serviceWorker' in navigator) {
  // Drop any stale worker that isn't ours (older builds shipped one that
  // served cached assets everywhere).
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      const script = (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL ?? '';
      if (new URL(script || SW_URL, window.location.origin).pathname !== SW_URL || import.meta.env.DEV) {
        void registration.unregister();
      }
    });
  }).catch(() => {
    // No-op: failure to unregister should not break app startup.
  });

  // Offline card (docs/CARD_ENGAGEMENT_PLAN.md §7.2): only clients opening a
  // public card get the worker; staff/owner pages never register it.
  if (onPublicCard && !import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch(() => {});
      // The first visit isn't controlled yet: hand the worker what this page
      // already fetched (hashed assets, the card API) so it works offline next time.
      const precache = () =>
        navigator.serviceWorker.ready.then((registration) => {
          const urls = performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((name) => name.includes('/assets/') || /\/public\/cards\/[^/]+\/[^/?#]+\/?(?:[?#]|$)/.test(name));
          registration.active?.postMessage({ type: 'stampee:precache', urls });
        }).catch(() => {});
      // After the lazy card chunk and API call have had time to land.
      setTimeout(precache, 4000);
    });
  }
}

// Capture `beforeinstallprompt` before the lazy card chunk mounts InstallPrompt.
if (onPublicCard) startInstallPromptCapture();

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
