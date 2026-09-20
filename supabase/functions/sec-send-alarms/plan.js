// 내 비서 — 알람 계산 (서버 함수와 앱이 **같은 파일**을 씁니다. 2026-09-20)
//
// ★ 알람시계 방식 (2026-09-20 대표님 요청)
//   · 알람 시각에 울리고(앱이 열려 있으면 20초), 완료·마감·날짜 바꾸기·1시간 뒤 중 하나를 하지 않으면
//     5분마다 다시 울립니다. 최대 12번(1시간) 뒤에는 멈춥니다 — 반복 알람은 다음 회차로 넘어갑니다.
//   · "몇 번째 울림인가" 는 따로 저장하지 않고 sec_alarm_log 에서 **이번 회차(due_at) 이후 기록 수**로 셉니다.
//     날짜를 바꾸면 due_at 이 바뀌어 저절로 0 부터 다시 셉니다 (칸 추가 없이 되게).
//   · 반복 알람에서 [완료] 는 "오늘 것 끝" — 다음 회차로 넘기고 계속 예정. [마감] 은 통째로 끝.
//
// 순수 계산만 있습니다 (Deno·브라우저·node 어디서나). 시험: node --test tests/

export const RING_SECONDS = 20;      // 앱이 열려 있을 때 한 번에 우는 시간
export const NAG_INTERVAL_MIN = 5;   // 처리 안 하면 이 간격으로 다시
export const NAG_MAX = 12;           // 이만큼 울리고도 처리가 없으면 그만 (5분 × 12 = 1시간)
export const VIBRATE = [400, 200, 400, 200, 400];

const KST_OFFSET_MIN = 9 * 60;
const MIN = 60_000;

/** 한국 시간 기준 다음 회차. 반복 없음이면 null. */
export function nextFire(current, repeat, repeatDays) {
  if (!repeat || repeat === "none") return null;
  const kst = new Date(current.getTime() + KST_OFFSET_MIN * MIN);
  const step = (d, days) => new Date(d.getTime() + days * 86_400_000);
  let next;
  if (repeat === "daily") {
    next = step(kst, 1);
  } else if (repeat === "weekdays") {
    next = step(kst, 1);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next = step(next, 1);
  } else if (repeat === "weekly") {
    const days = (repeatDays && repeatDays.length ? repeatDays : [kst.getUTCDay()]).map((d) => ((d % 7) + 7) % 7);
    next = step(kst, 1);
    let guard = 0;
    while (!days.includes(next.getUTCDay()) && guard++ < 8) next = step(next, 1);
  } else {
    // monthly — 같은 날짜, 없는 날짜(31일 등)면 그 달의 마지막 날
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), day = kst.getUTCDate();
    const lastOfNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    next = new Date(Date.UTC(y, m + 1, Math.min(day, lastOfNext), kst.getUTCHours(), kst.getUTCMinutes(), 0, 0));
  }
  return new Date(next.getTime() - KST_OFFSET_MIN * MIN);
}

/** 지금 이후의 첫 회차 (오래 꺼져 있었으면 지난 회차를 건너뜁니다). */
export function nextFireAfter(now, from, repeat, repeatDays) {
  let n = nextFire(from, repeat, repeatDays);
  let guard = 0;
  while (n && n <= now && guard++ < 400) n = nextFire(n, repeat, repeatDays);
  return n;
}

/** 이번 회차에서 지금까지 울린 횟수 — due_at 이후의 기록 수. */
export function ringCount(logs, dueAtIso) {
  const due = dueAtIso ? new Date(dueAtIso).getTime() : 0;
  return (logs || []).filter((l) => new Date(l.fired_at).getTime() >= due).length;
}

/**
 * 방금 울리고 난 뒤 표에 적을 값.
 * ringsSoFar 는 **이번 울림을 포함한** 횟수.
 */
export function planAfterFire(now, item, ringsSoFar) {
  if (ringsSoFar < NAG_MAX) {
    return { next_fire_at: new Date(now.getTime() + NAG_INTERVAL_MIN * MIN).toISOString(), due_at: item.due_at, gave_up: false };
  }
  // 그만 — 반복이면 다음 회차로, 아니면 멈춤 (목록의 '지난 일정' 으로 남음)
  const base = item.due_at ? new Date(item.due_at) : now;
  const n = nextFireAfter(now, base, item.repeat, item.repeat_days || []);
  return { next_fire_at: n ? n.toISOString() : null, due_at: n ? n.toISOString() : item.due_at, gave_up: true };
}

/**
 * 알람 창의 단추를 눌렀을 때 표에 적을 값 (앱이 씀).
 *   done   — 반복 없음: 완료 / 반복: 다음 회차로 넘기고 계속 예정
 *   closed — 통째로 마감
 *   later  — 1시간 뒤로 미루고 진행 중
 */
export function afterAction(action, item, now) {
  const notify = item.notify !== false;
  if (action === "closed") return { status: "closed", next_fire_at: null };
  if (action === "later") {
    const d = new Date(now.getTime() + 60 * MIN).toISOString();
    return { status: "doing", due_at: d, next_fire_at: notify ? d : null };
  }
  if (action === "done") {
    const base = item.due_at ? new Date(item.due_at) : now;
    const n = nextFireAfter(now, base, item.repeat, item.repeat_days || []);
    if (!n) return { status: "done", next_fire_at: null };
    return { status: "todo", due_at: n.toISOString(), next_fire_at: notify ? n.toISOString() : null };
  }
  return { status: item.status, next_fire_at: item.next_fire_at ?? null };
}

/** 휴대폰 알림에 실어 보내는 긴 진동 — 징·징·징을 20초 동안. */
export function longVibrate() {
  const out = [];
  let total = 0;
  while (total < RING_SECONDS * 1000 - 400) { out.push(400, 200); total += 600; }
  out.push(400);
  return out;
}

// ★ 2026-09-20 저녁 — 휴대폰 알림은 한 번에 "띠링·진동 한 번" 뿐이라(긴 진동 무늬는 안드로이드 크롬이 무시)
//   20초 동안 이어지게 하려면 같은 알림을 몇 초 간격으로 **여러 번** 보내야 합니다. 같은 tag + renotify 라
//   알림이 늘어나지 않고 소리·진동만 다시 납니다.
export const RING_PULSES = 4;
export const PULSE_GAP_MS = 6000;
export function pulseDelays() {
  return Array.from({ length: RING_PULSES }, (_, i) => i * PULSE_GAP_MS);
}
