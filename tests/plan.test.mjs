// 알람 계산 시험 — node --test tests/
// 2026-10-24 대표님 요청: 소리·진동·알림 한 번
// 2026-11-04 대표님 요청: 고치지 않으면 10분 뒤 한 번, 그 뒤로는 고칠 때까지 1시간마다
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFire, planAfterFire, NAG_INTERVAL_MIN, NAG_REPEAT_MIN, nagDelayMin, nagNotice, ringCount, ringFromTimes, VIBRATE, afterAction, fireAtOnSave } from "../supabase/functions/sec-send-alarms/plan.js";

const T = (s) => new Date(s);
const MIN = 60_000;

test("설정값 — 처음 다시 알림은 10분 뒤 · 그 뒤로는 1시간마다 · 진동 한 번", () => {
  assert.equal(NAG_INTERVAL_MIN, 10);
  assert.equal(NAG_REPEAT_MIN, 60);
  assert.equal(nagDelayMin(1), 10);
  assert.equal(nagDelayMin(2), 60);
  assert.equal(nagDelayMin(50), 60);
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
  assert.equal(p.next_round, false);
});

test("울린 뒤 계획 — 2번째 울림 뒤에는 1시간 뒤, 날짜(due_at)는 그대로", () => {
  const now = T("2026-09-20T00:10:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, 2);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 60 * MIN).toISOString());
  assert.equal(p.due_at, "2026-09-20T00:00:00.000Z");
});

test("울린 뒤 계획 — 고치지 않으면 멈추지 않고 계속 1시간 뒤", () => {
  const now = T("2026-09-27T05:10:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "none", repeat_days: [] }, 170);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 60 * MIN).toISOString());
});

test("울린 뒤 계획 — 반복 알람도 다음 회차 전까지는 1시간마다, 회차 날짜는 그대로", () => {
  const now = T("2026-09-20T00:10:10Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [] }, 2);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 60 * MIN).toISOString());
  assert.equal(p.due_at, "2026-09-20T00:00:00.000Z");
});

test("울린 뒤 계획 — 다음 회차가 1시간 안에 오면 그 회차로 넘어간다", () => {
  const now = T("2026-09-20T23:30:00Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [] }, 5);
  assert.equal(p.next_fire_at, "2026-09-21T00:00:00.000Z");
  assert.equal(p.due_at, "2026-09-21T00:00:00.000Z");
});

test("울린 뒤 계획 — 오래 꺼져 있어 지난 회차가 쌓였으면 다음 회차까지 그대로 1시간마다", () => {
  const now = T("2026-09-25T03:00:00Z");
  const p = planAfterFire(now, { due_at: "2026-09-20T00:00:00.000Z", repeat: "daily", repeat_days: [] }, 2);
  assert.equal(p.next_fire_at, new Date(now.getTime() + 60 * MIN).toISOString());
});

test("알림 문구 — 첫 울림은 10분 뒤, 그다음은 1시간마다, '마지막 알림' 은 없다", () => {
  assert.match(nagNotice(1), /10분 뒤/);
  assert.match(nagNotice(2), /1시간마다/);
  assert.doesNotMatch(nagNotice(2), /마지막/);
});

test("몇 번째 울림인가 — 울린 적 없으면 1, 다시 울렸으면 1보다 크고 울릴 때마다 달라진다", () => {
  const due = "2026-09-20T00:00:00.000Z";
  assert.equal(ringFromTimes({ due_at: due, last_fired_at: null }), 1);
  assert.equal(ringFromTimes({ due_at: due, last_fired_at: "2026-09-19T00:00:00Z" }), 1);
  assert.equal(ringFromTimes({ due_at: due, last_fired_at: "2026-09-20T00:00:05Z" }), 1);
  const r2 = ringFromTimes({ due_at: due, last_fired_at: "2026-09-20T00:10:05Z" });
  const r3 = ringFromTimes({ due_at: due, last_fired_at: "2026-09-20T01:10:05Z" });
  assert.equal(r2, 2);
  assert.ok(r3 > r2);
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

test("저장 — 반복 알람은 울린 뒤 고쳐도 죽지 않고 지금 이후 첫 회차로 넘어간다", () => {
  const now = T("2026-09-20T03:00:00Z");
  const it = { due_at: "2026-09-20T00:00:00.000Z", status: "todo", notify: true, repeat: "daily", repeat_days: [] };
  assert.equal(fireAtOnSave(it, now, false), "2026-09-21T00:00:00.000Z");
});

test("저장 — 반복 없는 알람을 울린 뒤 고치면 반복이 멈춘다", () => {
  const now = T("2026-09-20T03:00:00Z");
  const it = { due_at: "2026-09-20T00:00:00.000Z", status: "todo", notify: true, repeat: "none", repeat_days: [] };
  assert.equal(fireAtOnSave(it, now, false), null);
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
