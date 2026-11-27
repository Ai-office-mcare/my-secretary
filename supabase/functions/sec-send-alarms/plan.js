// 내 비서 — 알람 계산 (서버 함수와 앱이 **같은 파일**을 씁니다. 2026-09-20)
//
// ★ 한 번 울림 → 10분 뒤 → 그 뒤로는 고칠 때까지 1시간마다 (2026-11-04 대표님 요청 — 예전 "10분 뒤 한 번 더 후 멈춤" 을 바꿈)
//   · 울릴 때마다 소리 한 번 · 진동 한 번 · 알림 한 번.
//   · 시간·날짜·완료 등 **무엇이든 하나라도 고치거나 지우지 않으면** 10분 뒤 다시, 그다음부터 1시간마다 계속 알립니다.
//     — 반복 알람은 다음 회차가 오면 그 회차로 넘어가 처음부터 다시 셉니다.
//   · 고치면(저장하면) 그 자리에서 다시 알림이 꺼집니다 — fireAtOnSave: 이미 지난 시각이면 next_fire_at 을 비움
//     (반복 알람은 지금 이후 첫 회차로).
//   · "몇 번째 울림인가" 는 따로 저장하지 않고 sec_alarm_log 에서 **이번 회차(due_at) 이후 기록 수**로 셉니다.
//     날짜를 바꾸면 due_at 이 바뀌어 저절로 0 부터 다시 셉니다 (칸 추가 없이 되게).
//   · 반복 알람에서 [완료] 는 "오늘 것 끝" — 다음 회차로 넘기고 계속 예정. [마감] 은 통째로 끝.
//
// 순수 계산만 있습니다 (Deno·브라우저·node 어디서나). 시험: node --test tests/

export const FLASH_SECONDS = 20;     // 앱이 열려 있을 때 화면이 깜빡이는 시간 (소리·진동은 처음 한 번만)
export const NAG_INTERVAL_MIN = 10;  // 첫 알림 뒤 이만큼 있다가 다시
export const NAG_REPEAT_MIN = 60;    // 그 뒤로는 고칠 때까지 이 간격으로 계속
export const VIBRATE = [500];        // 진동 한 번

/** 저장할 때의 다음 울릴 시각. 이미 지난 시각의 기존 일정을 고쳤으면 다시 알리지 않습니다. */
export function fireAtOnSave(item, now, isNew) {
  if (!item.notify || !item.due_at || (item.status !== "todo" && item.status !== "doing")) return null;
  if (isNew || new Date(item.due_at).getTime() > now.getTime()) return item.due_at;
  // ★ 2026-11-04: 반복 알람은 다음 회차 전까지 날짜가 지난 채로 있으므로, 고쳤다고 끄지 않고 다음 회차로 넘깁니다.
  const n = nextFireAfter(now, new Date(item.due_at), item.repeat, item.repeat_days || []);
  return n ? n.toISOString() : null;
}

/** rings(이번 울림 포함)번 울린 뒤 다시 울릴 때까지의 분. */
export function nagDelayMin(rings) {
  return rings <= 1 ? NAG_INTERVAL_MIN : NAG_REPEAT_MIN;
}

/** 알림·알람 창 끝에 붙는 안내 (서버 함수와 앱이 같이 씀). */
export function nagNotice(rings) {
  return rings <= 1
    ? `시간·날짜·완료 등을 바꾸지 않으면 ${NAG_INTERVAL_MIN}분 뒤 다시 알립니다`
    : `시간·날짜·완료 등을 바꾸거나 지울 때까지 ${NAG_REPEAT_MIN / 60}시간마다 다시 알립니다`;
}

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
 * 앱이 표의 시각만으로 어림한 "몇 번째 울림" (기록 표를 읽지 않으려고). 1 이면 첫 울림, 2 이상이면 다시 알림.
 * 정확한 횟수는 아니고 울릴 때마다 달라지기만 합니다 — 앱이 같은 울림을 두 번 내지 않는 데 씁니다.
 */
export function ringFromTimes(item) {
  if (!item.last_fired_at || !item.due_at) return 1;
  const gap = new Date(item.last_fired_at).getTime() - new Date(item.due_at).getTime();
  return Math.max(1, Math.round(gap / (NAG_INTERVAL_MIN * MIN)) + 1);
}

/**
 * 앱을 연 시각(openedAt, ms) 전에 이미 울린 알람인지 — 휴대폰 알림이 먼저 울렸고 앱을 열었다는 건 확인한 것이므로
 * 앱은 알람 창만 띄우고 다시 울리지 않습니다 (2026-11-27 대표님 요청). 마지막으로 울린 때 = 서버가 다시 알린 때 또는 제 시각.
 */
export function rangBefore(item, openedAt) {
  const at = Math.max(item.due_at ? new Date(item.due_at).getTime() : 0, item.last_fired_at ? new Date(item.last_fired_at).getTime() : 0);
  return at > 0 && at <= openedAt;
}

/**
 * 방금 울리고 난 뒤 표에 적을 값.
 * ringsSoFar 는 **이번 울림을 포함한** 횟수.
 */
export function planAfterFire(now, item, ringsSoFar) {
  const nag = new Date(now.getTime() + nagDelayMin(ringsSoFar) * MIN);
  // 반복 알람: 다음 회차가 먼저 오면 그 회차로 넘어갑니다 (회차 날짜가 바뀌어 횟수도 처음부터).
  const base = item.due_at ? new Date(item.due_at) : now;
  const n = nextFireAfter(now, base, item.repeat, item.repeat_days || []);
  if (n && n <= nag) return { next_fire_at: n.toISOString(), due_at: n.toISOString(), next_round: true };
  return { next_fire_at: nag.toISOString(), due_at: item.due_at, next_round: false };
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

// ★ 2026-10-24 — 한 번 울릴 때 알림도 한 번만 보냅니다 (예전에는 20초를 채우려고 6초 간격 4번).
export const RING_PULSES = 1;
export const PULSE_GAP_MS = 6000;
export function pulseDelays() {
  return Array.from({ length: RING_PULSES }, (_, i) => i * PULSE_GAP_MS);
}
