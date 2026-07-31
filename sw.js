// Версія кешу. Зміни цей рядок (напр. на "v3"), коли захочеш примусово
// оновити кеш у всіх користувачів після серйозних змін у файлах.
const CACHE_NAME = "espanol-srs-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Встановлення: кладемо весь "каркас" застосунку в кеш
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Активація: прибираємо старі версії кешу
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Стратегія: спершу кеш (щоб працювало офлайн і швидко),
// а якщо файлу нема в кеші — пробуємо мережу.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
