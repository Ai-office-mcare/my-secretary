// 알람 계산 시험 — node --test tests/
// 2026-10-24 대표님 요청: 소리·진동·알림 한 번, 고치지 않으면 10분 뒤 한 번 더
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFire, planAfterFire, NAG_INTERVAL_MIN, NAG_MAX, ringCount, VIBRATE, afterAction, fireAtOnSave } from "../supabase/functions/sec-send-alarms/plan.js";

const T = (s) => new Date(s);
const MIN = 60_000;

test("설정값 — 10분 뒤 한 번 더 · 모두 2번 · 진동 한 번", () => {
  assert.equal(NAG_INTERVAL_MIN, 10);
  assert.equal(NAG_MAX, 2);
  assert.equal(VIBRATE.length, 1);
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

test("울린 뒤 계획 — 첫 알림 뒤에는 10분 뒤 한 번 더, 날짜(due_at)는 그대로", () => {
  const now = T("2026-09-20T00:00:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, 1);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 10 * MIN).toISOString());
  assert.equal(p.due_at, "2026-09-20T00:00:00.000Z");
  assert.equal(p.gave_up, false);
});

test("울린 뒤 계획 — 다시 알림(2번째) 뒤 반복 없음은 멈춤(next_fire_at null)", () => {
  const now = T("2026-09-20T00:10:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, NAG_MAX);
  assert.equal(p.next_fire_at, null);
  assert.equal(p.gave_up, true);
});

test("울린 뒤 계획 — 다시 알림(2번째) 뒤 반복 알람은 다음 회차로 넘어간다", () => {
  const now = T("2026-09-20T00:10:10Z");
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

test("한 번 울릴 때 알림은 한 번만 보낸다", async () => {
  const { pulseDelays, RING_PULSES } = await import("../supabase/functions/sec-send-alarms/plan.js");
  assert.equal(RING_PULSES, 1);
  assert.deepEqual(pulseDelays(), [0]);
});

test("저장 — 이미 울린(지난) 일정을 무엇이든 고치면 다시 알리지 않는다", () => {
  const now = T("2026-09-20T00:03:00Z");
  const past = { due_at: "2026-09-20T00:00:00.000Z", status: "todo", notify: true };
  assert.equal(fireAtOnSave(past, now, false), null);
  assert.equal(fireAtOnSave({ ...past, status: "doing" }, now, false), null);
});

test("저장 — 앞으로의 시각으로 바꾸면 그 시각에 울린다", () => {
  const now = T("2026-09-20T00:03:00Z");
  const it = { due_at: "2026-09-20T02:00:00.000Z", status: "doing", notify: true };
  assert.equal(fireAtOnSave(it, now, false), "2026-09-20T02:00:00.000Z");
});

test("저장 — 새 일정은 시각이 막 지났어도 울린다, 완료·마감·알림 끔은 안 울린다", () => {
  const now = T("2026-09-20T00:03:00Z");
  assert.equal(fireAtOnSave({ due_at: "2026-09-20T00:02:00.000Z", status: "todo", notify: true }, now, true), "2026-09-20T00:02:00.000Z");
  assert.equal(fireAtOnSave({ due_at: "2026-09-20T02:00:00.000Z", status: "done", notify: true }, now, false), null);
  assert.equal(fireAtOnSave({ due_at: "2026-09-20T02:00:00.000Z", status: "closed", notify: true }, now, false), null);
  assert.equal(fireAtOnSave({ due_at: "2026-09-20T02:00:00.000Z", status: "todo", notify: false }, now, false), null);
});
