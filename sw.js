// Cache uniquement la coquille de l'app (même origine). Aucune requête Odoo n'est interceptée ni mise en cache.
const V = "v1";
const FILES = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request)
        .then((r) => { if (r.ok) caches.open(V).then((c) => c.put(e.request, r.clone())); return r; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
