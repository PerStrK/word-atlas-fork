/* Word Atlas offline cache: app shell network-first, media cache-first.
   The media cache has its own stable name so app updates never wipe warmed
   audio; it is only reset by an explicit media version bump. */
const VERSION = "atlas-v12";
const SHELL = `${VERSION}-shell`;
const MEDIA = "atlas-media-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Migrate any warmed media from legacy per-version caches.
      const keys = await caches.keys();
      const media = await caches.open(MEDIA);
      for (const key of keys) {
        if (key.endsWith("-media") && key !== MEDIA) {
          const legacy = await caches.open(key);
          for (const req of await legacy.keys()) {
            if (!(await media.match(req))) await media.put(req, await legacy.match(req));
          }
        }
      }
      await Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/api/")) return; // account/progress API: always network
  const isMediaPath = /\/atlas\/(img|thumb|audio)\//.test(url.pathname);
  // 媒体走「缓存优先 + 防卡死」（atlas-v10）：查缓存最多等 800ms，
  // 超时就直连网络——缓存层再 sick 也卡不住图片和语音；
  // 命中则秒出，未命中边下边存，预热功能照常。
  if (isMediaPath) {
    event.respondWith((async () => {
      const media = await caches.open(MEDIA);
      const hit = await Promise.race([
        media.match(req),
        new Promise((r) => setTimeout(() => r(null), 800)),
      ]);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === "basic" && !req.headers.has("range")) {
        media.put(req, res.clone()).then(() => trim(MEDIA, 8000)).catch(() => {});
      }
      return res;
    })());
    return;
  }
  if (req.headers.has("range")) return;
  const isShell = req.mode === "navigate" || url.pathname.endsWith("/index.json") || /\/entries\/\d+\.json$/.test(url.pathname);
  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(new URL("./", self.registration.scope).href))),
    );
    return;
  }
  if (isMediaPath) {
    event.respondWith(
      caches.open(MEDIA).then((media) =>
        media.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === "basic") {
                media.put(req, res.clone()).then(() => trim(MEDIA, 8000)).catch(() => {});
              }
              return res;
            }),
        ),
      ),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
