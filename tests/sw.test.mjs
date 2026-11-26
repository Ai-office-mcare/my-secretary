// 서비스워커 알림 시험 — 소리·진동 3번 연속, 손대면 멈춤. node --test tests/sw.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

// 알림·시간을 흉내 냅니다. onSleep 은 기다리는 동안 일어난 일(몇 번째 기다림인지)을 넣는 자리.
// 기기 설정(sec-set 의 helperVoice)을 흉내 내는 작은 IndexedDB
function fakeIDB(store) {
  const later = (req, val) => { queueMicrotask(() => { req.result = val; req.onsuccess && req.onsuccess(); }); return req; };
  const db = { close() {}, transaction: () => ({ objectStore: () => ({ get: (k) => later({}, store[k]) }) }) };
  return { open: (name) => { if (name !== "sec-set") throw new Error("only sec-set"); return later({}, db); } };
}
async function push(data, { visible = () => false, onSleep = () => {}, brokenList = false, settings = null } = {}) {
  const handlers = {}, shown = [], posted = [], gaps = [];
  const state = { tray: [], sleeps: 0 };
  const self = {
    location: { origin: "https://x.test", href: "https://x.test/sw.js" },
    addEventListener: (t, f) => (handlers[t] = f),
    skipWaiting() {},
    clients: { claim() {}, matchAll: async () => [{ visibilityState: visible(state) ? "visible" : "hidden", postMessage: (m) => posted.push(m) }] },
    registration: {
      showNotification: async (title, o) => { shown.push(o); state.tray = [{ tag: o.tag }]; },
      getNotifications: async ({ tag }) => { if (brokenList) throw new Error("x"); return state.tray.filter((n) => n.tag === tag); },
    },
  };
  const setTimeout = (f, ms) => { gaps.push(ms); onSleep(++state.sleeps, state); queueMicrotask(f); };
  vm.runInNewContext(src, { self, setTimeout, URL, Request: class {}, caches: {}, indexedDB: settings ? fakeIDB(settings) : {}, Promise });
  let done;
  handlers.push({ data: { json: () => data }, waitUntil: (p) => (done = p) });
  await done;
  return { shown, posted, gaps };
}

test("손대지 않으면 소리·진동이 3번 연속으로 울린다", async () => {
  const r = await push({ title: "시험", tag: "sec-1", vibrate: [500] });
  assert.equal(r.shown.length, 3);
  for (const o of r.shown) { assert.equal(o.silent, false); assert.equal(o.renotify, true); assert.equal(o.tag, "sec-1"); assert.equal(o.vibrate[0], 500); }
  assert.equal(r.gaps.length, 2);
  assert.equal(r.posted.length, 1, "앱에는 한 번만 알린다");
});

test("첫 울림 뒤 알림을 지우거나 누르면 더 울리지 않는다", async () => {
  const r = await push({ title: "시험", tag: "sec-1" }, { onSleep: (_n, s) => { s.tray = []; } });
  assert.equal(r.shown.length, 1);
});

test("두 번째 울림 뒤 앱을 열면 멈춘다", async () => {
  const r = await push({ title: "시험", tag: "sec-1" }, { visible: (s) => s.sleeps >= 2 });
  assert.equal(r.shown.length, 2);
});

test("앱이 화면에 떠 있으면 알림은 조용히 한 번 (앱이 3번 울림)", async () => {
  const r = await push({ title: "시험", tag: "sec-1" }, { visible: () => true });
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].silent, true);
  assert.equal(r.shown[0].tag, "sec-1-quiet", "화면켜기 앱이 목소리를 또 내지 않게 표시");
});

test("알림 목록을 못 읽는 휴대폰에서도 3번 울린다", async () => {
  const r = await push({ title: "시험", tag: "sec-1" }, { brokenList: true });
  assert.equal(r.shown.length, 3);
});

test("작은 아이콘은 투명 배경 전용 그림", async () => {
  const r = await push({ title: "시험" });
  assert.equal(r.shown[0].badge, "./badge-96.png");
});

test("목소리 휴대폰: 알림은 조용히, tag 끝 -voice 로 화면켜기 앱에 알리고 3번 울림은 그대로", async () => {
  const r = await push({ title: "시험", tag: "sec-1", vibrate: [500] }, { settings: { helperVoice: true } });
  assert.equal(r.shown.length, 3);
  for (const o of r.shown) { assert.equal(o.silent, true); assert.equal(o.tag, "sec-1-voice"); }
});

test("목소리 설정이 꺼져 있거나 읽지 못하면 기본 알림음", async () => {
  for (const settings of [{ helperVoice: false }, {}]) {
    const r = await push({ title: "시험", tag: "sec-1" }, { settings });
    assert.equal(r.shown[0].silent, false); assert.equal(r.shown[0].tag, "sec-1");
  }
});

test("목소리 휴대폰이어도 앱이 화면에 떠 있으면 앱이 말하고 알림은 -quiet", async () => {
  const r = await push({ title: "시험", tag: "sec-1" }, { settings: { helperVoice: true }, visible: () => true });
  assert.equal(r.shown.length, 1); assert.equal(r.shown[0].tag, "sec-1-quiet");
});
