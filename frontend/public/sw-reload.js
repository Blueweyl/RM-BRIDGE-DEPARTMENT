// Loaded by the service worker (vite.config.js → workbox.importScripts).
// When a new version of the app takes over, pages still showing the old version reload once,
// so phones and computers switch to the new app without anyone clearing data.
// (Unsaved typing is safe: the app saves its draft when the page is left.)
// The reload must start after activation has finished: a page reload is itself served by this
// service worker, which waits for activation, so reloading from inside activation would hang.
function reloadOpenPages() {
  self.clients.matchAll({ type: 'window' })
    .then(list => list.forEach(c => { if (c.navigate) c.navigate(c.url).catch(() => {}); }));
}
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  setTimeout(reloadOpenPages, 1000);
});
