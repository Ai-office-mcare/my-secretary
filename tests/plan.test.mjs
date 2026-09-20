// 알람시계 방식(2026-09-20 대표님 요청) 계산 시험 — node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFire, planAfterFire, NAG_INTERVAL_MIN, NAG_MAX, ringCount, RING_SECONDS, longVibrate, afterAction } from "../supabase/functions/sec-send-alarms/plan.js";

const T = (s) => new Date(s);
const MIN = 60_000;

test("설정값 — 20초 울림 · 5분 간격 · 최대 12번(1시간)", () => {
  assert.equal(RING_SECONDS, 20);
  assert.equal(NAG_INTERVAL_MIN, 5);
  assert.equal(NAG_MAX, 12);
});

test("다음 회차 — 매일은 한국 시간 기준 하루 뒤 같은 시각", () => {
  // 2026-09-20 09:00 KST = 00:00Z
  const n = nextFire(T("2026-09-20T00:00:00Z"), "daily", []);
  assert.equal(n.toISOString(), "2026-09-21T00:00:00.000Z");
});

test("다음 회차 — 평일은 금요일 다음이 월요일", () => {
  // 2026-09-25 은 금요일
  const n = nextFire(T("2026-09-25T00:00:00Z"), "weekdays", []);
  assert.equal(n.toISOString(), "2026-09-28T00:00:00.000Z");
});

test("다음 회차 — 반복 없음은 null", () => {
  assert.equal(nextFire(T("2026-09-20T00:00:00Z"), "none", []), null);
});

test("울린 횟수 — 이번 회차(due_at) 이후 기록만 센다", () => {
  const due = "2026-09-20T00:00:00.000Z";
  const logs = [{ fired_at: "2026-09-19T00:00:00Z" }, { fired_at: "2026-09-20T00:00:05Z" }, { fired_at: "2026-09-20T00:05:03Z" }];
  assert.equal(ringCount(logs, due), 2);
});

test("울린 뒤 계획 — 아직 12번 안 됐으면 5분 뒤 다시, 날짜(due_at)는 그대로", () => {
  const now = T("2026-09-20T00:00:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, 1);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 5 * MIN).toISOString());
  assert.equal(p.due_at, "2026-09-20T00:00:00.000Z");
  assert.equal(p.gave_up, false);
});

test("울린 뒤 계획 — 12번째면 반복 없음은 멈춤(next_fire_at null)", () => {
  const now = T("2026-09-20T00:55:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, NAG_MAX);
  assert.equal(p.next_fire_at, null);
  assert.equal(p.gave_up, true);
});

test("울린 뒤 계획 — 12번째면 반복 알람은 다음 회차로 넘어간다", () => {
  const now = T("2026-09-20T00:55:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [] }, NAG_MAX);
  assert.equal(p.due_at, "2026-09-21T00:00:00.000Z");
  assert.equal(p.next_fire_at, "2026-09-21T00:00:00.000Z");
  assert.equal(p.gave_up, true);
});

test("울린 뒤 계획 — 오래 꺼져 있어 다음 회차도 이미 지났으면 지금 이후 첫 회차로", () => {
  const now = T("2026-09-25T03:00:00Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [] }, NAG_MAX);
  assert.equal(p.next_fire_at, "2026-09-26T00:00:00.000Z");
});

test("완료를 누르면 — 반복 없음은 완료, 반복은 다음 회차로 넘기고 계속 예정", () => {
  const now = T("2026-09-20T00:03:00Z");
  const a = afterAction("done", { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [], status: "todo" }, now);
  assert.equal(a.status, "done");
  assert.equal(a.next_fire_at, null);
  const b = afterAction("done", { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [], status: "todo", notify: true }, now);
  assert.equal(b.status, "todo");
  assert.equal(b.due_at, "2026-09-21T00:00:00.000Z");
  assert.equal(b.next_fire_at, "2026-09-21T00:00:00.000Z");
});

test("마감을 누르면 — 반복이라도 통째로 마감(더 안 울림)", () => {
  const a = afterAction("closed", { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [], status: "todo" }, T("2026-09-20T00:03:00Z"));
  assert.equal(a.status, "closed");
  assert.equal(a.next_fire_at, null);
});

test("1시간 뒤를 누르면 — 날짜를 1시간 뒤로, 진행 중, 그때 다시 울림", () => {
  const now = T("2026-09-20T00:03:00Z");
  const a = afterAction("later", { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [], status: "todo", notify: true }, now);
  assert.equal(a.status, "doing");
  assert.equal(a.due_at, "2026-09-20T01:03:00.000Z");
  assert.equal(a.next_fire_at, "2026-09-20T01:03:00.000Z");
});

test("긴 진동 — 20초를 채우는 징·징·징 무늬", () => {
  const v = longVibrate();
  const total = v.reduce((a, b) => a + b, 0);
  assert.ok(total >= 19_000 && total <= 21_000, String(total));
  assert.ok(v.length % 2 === 1); // 진동으로 시작해 진동으로 끝
});
