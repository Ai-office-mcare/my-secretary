/* 내 비서 — 서비스워커 (2026-09-15)
 * · 앱을 닫아 두어도 푸시를 받아 알림을 띄웁니다 (진동 징·징·징 3번)
 * · 알림을 누르면 그 알람 카드로 앱을 엽니다
 * · 화면 파일은 네트워크 우선, 안 되면 저장본 (오프라인에서도 열림)
 */
const CACHE = "sec-v2";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => null);
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html"))),
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "내 비서", body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "내 비서 알람";
  const options = {
    body: data.body || "",
    tag: data.tag || "sec-alarm",
    renotify: true,
    requireInteraction: true,
    // ★ 소리는 휴대폰의 알림음 설정을 따릅니다. 조용히(silent) 보내지 않습니다.
    silent: false,
    // ★ 징·징·징 3번 (안드로이드 크롬이 존중하는 범위에서)
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : [400, 200, 400, 200, 400],
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: data.url || "./", item_id: data.item_id || null },
    actions: [
      { action: "done", title: "완료" },
      { action: "snooze", title: "1시간 뒤" },
      { action: "open", title: "열기" },
    ],
  };
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // 앱이 열려 있으면 앱 안에서도 소리·진동·깜빡임을 냅니다 (알림 소리가 꺼진 휴대폰이라도 앱 소리는 남)
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        for (const c of list) c.postMessage({ type: "alarm", item_id: data.item_id || null, title, body: options.body });
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const itemId = e.notification.data && e.notification.data.item_id;
  const action = e.action || "open";
  // 완료·1시간 뒤는 앱이 열리면서 처리합니다 (앱이 로그인 상태를 갖고 있습니다)
  const target = new URL("./", self.location.href);
  target.hash = itemId ? `alarm=${itemId}&do=${action}` : "";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(target.origin)) {
          c.navigate(target.href);
          return c.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
