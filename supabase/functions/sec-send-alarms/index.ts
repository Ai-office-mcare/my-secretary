// 내 비서 — 알람 보내기 (Supabase Edge Function, 2026-09-15)
//
// ★ 1분마다 pg_cron 이 이 함수를 부릅니다 (supabase/cron.sql). 사람이 직접 부르지 않습니다.
//   · 머리표 x-cron-secret 이 맞아야만 돕니다 (아무나 못 부름)
//   · next_fire_at <= 지금 이고 status 가 todo/doing 이며 notify 가 켜진 것만 고릅니다 (한 번에 최대 50건)
//   · 그 사람의 등록 기기 전부에 웹 푸시. 진동 [400,200,400,200,400] (징·징·징)
//   · ★ 알람시계 방식 (2026-09-20): 울린 뒤 처리(완료·마감·날짜 바꾸기·1시간 뒤)가 없으면 5분 뒤 다시 울립니다.
//     최대 12번(1시간). 그래도 없으면 반복 알람은 다음 회차로, 반복 없음은 멈춤. 계산은 plan.js (앱과 같은 파일).
//     몇 번째인지는 sec_alarm_log 에서 이번 회차(due_at) 이후 기록 수로 셉니다.
//   · 기기가 사라졌다(404/410)고 하면 그 등록을 지웁니다
//
// 비밀값(supabase secrets): VAPID_KEYS_JSON(JWK 두 개) · VAPID_SUBJECT · CRON_SECRET
//   (SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 줍니다)

import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { NAG_MAX, RING_PULSES, longVibrate, planAfterFire, pulseDelays, ringCount } from "./plan.js";

const KST_OFFSET_MIN = 9 * 60;
const MAX_PER_RUN = 50;

type Item = {
  id: string;
  user_id: string;
  title: string;
  memo: string;
  due_at: string | null;
  repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  repeat_days: number[];
  next_fire_at: string;
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };

function kstText(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MIN * 60_000);
  const hh = String(k.getUTCHours()).padStart(2, "0");
  const mm = String(k.getUTCMinutes()).padStart(2, "0");
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hh}:${mm}`;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const vapidJson = Deno.env.get("VAPID_KEYS_JSON") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!vapidJson) {
    return new Response(JSON.stringify({ ok: false, error: "vapid keys missing" }), { status: 500 });
  }

  const now = new Date();
  const { data: items, error } = await db
    .from("sec_items")
    .select("id,user_id,title,memo,due_at,repeat,repeat_days,next_fire_at")
    .lte("next_fire_at", now.toISOString())
    .eq("notify", true)
    .in("status", ["todo", "doing"])
    .order("next_fire_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  if (!items || items.length === 0) return new Response(JSON.stringify({ ok: true, fired: 0 }));

  // 비밀값은 JWK 두 개를 담은 JSON 문자열입니다 ({publicKey, privateKey}).
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJson), { extractable: false });
  const app = await webpush.ApplicationServer.new({ contactInformation: subject, vapidKeys });

  // ── 1) 보낼 것 준비 + 표 갱신 (울리기 **전에** 다음 시각을 적어 두어, 도중에 끊겨도 다음 분에 겹쳐 울리지 않게)
  type Job = { item: Item; subs: Sub[]; rings: number; body: Record<string, unknown>; plan: ReturnType<typeof planAfterFire>; alive: Set<string>; detail: string[] };
  const jobs: Job[] = [];
  for (const item of items as Item[]) {
    const { data: subs } = await db
      .from("sec_push_subscriptions")
      .select("id,endpoint,p256dh,auth,fail_count")
      .eq("user_id", item.user_id);

    // 이번 회차에서 몇 번째 울림인가 (이번 것 포함)
    const { data: logs } = await db
      .from("sec_alarm_log")
      .select("fired_at")
      .eq("item_id", item.id)
      .gte("fired_at", item.due_at ?? "1970-01-01T00:00:00Z");
    const rings = ringCount(logs ?? [], item.due_at) + 1;
    const when = kstText(new Date(item.due_at ?? item.next_fire_at));
    const nth = rings > 1 ? ` (${rings}번째 알림)` : "";

    const body = {
      title: item.title + nth,
      // ★ 잠금화면에서도 할 일·언제·세부내용이 다 보이게 (2026-09-20 대표님 요청). 메모는 줄바꿈으로 그대로.
      body: `${when}${item.memo ? "\n" + item.memo : ""}\n${rings < NAG_MAX ? "완료·마감·날짜 바꾸기를 안 하면 5분 뒤 다시 울립니다" : "마지막 알림입니다"}`,
      item_id: item.id,
      tag: `sec-${item.id}`,
      vibrate: longVibrate(),
      ring: rings,
      url: `#alarm=${item.id}`,
    };

    // ★ 알람시계 방식 — 처리가 없으면 5분 뒤 다시. 12번째면 그만(반복은 다음 회차로).
    const plan = planAfterFire(now, item, rings);
    await db
      .from("sec_items")
      .update({ next_fire_at: plan.next_fire_at, last_fired_at: now.toISOString(), due_at: plan.due_at })
      .eq("id", item.id);

    jobs.push({ item, subs: (subs ?? []) as Sub[], rings, body, plan, alive: new Set((subs ?? []).map((x: Sub) => x.id)), detail: [] });
  }

  // ── 2) 20초 동안 6초 간격으로 4번 — 휴대폰은 알림 한 번에 한 번만 울리므로 같은 알림(tag)을 되풀이 보냅니다
  const sentCount = new Map<string, number>(); // item.id → 첫 펄스에서 성공한 기기 수
  const delays = pulseDelays();
  for (let p = 0; p < RING_PULSES; p++) {
    if (p > 0) await new Promise((r) => setTimeout(r, delays[p] - delays[p - 1]));
    for (const job of jobs) {
      const payload = JSON.stringify({ ...job.body, pulse: p + 1, pulses: RING_PULSES });
      for (const s of job.subs) {
        if (!job.alive.has(s.id)) continue;
        try {
          const subscriber = app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
          // ttl 5분 — 5분마다 다시 울리므로 늦게 도착한 옛 알림이 겹쳐 오지 않게
          await subscriber.pushTextMessage(payload, { ttl: 5 * 60, urgency: webpush.Urgency.High });
          if (p === 0) {
            sentCount.set(job.item.id, (sentCount.get(job.item.id) ?? 0) + 1);
            await db.from("sec_push_subscriptions").update({ last_ok_at: now.toISOString(), fail_count: 0 }).eq("id", s.id);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          job.detail.push(`p${p + 1}:` + msg.slice(0, 100));
          job.alive.delete(s.id);
          if (p === 0) {
            const gone = /410|404|not found|gone|expired/i.test(msg);
            if (gone || s.fail_count >= 5) {
              await db.from("sec_push_subscriptions").delete().eq("id", s.id);
            } else {
              await db.from("sec_push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id);
            }
          }
        }
      }
    }
  }

  // ── 3) 기록
  let fired = 0;
  const results: unknown[] = [];
  for (const job of jobs) {
    const sent = sentCount.get(job.item.id) ?? 0;
    await db.from("sec_alarm_log").insert({
      user_id: job.item.user_id,
      item_id: job.item.id,
      devices: job.subs.length,
      sent,
      detail: (`pulses:${RING_PULSES} ` + job.detail.join(" | ")).trim(),
    });
    fired++;
    results.push({ id: job.item.id, devices: job.subs.length, sent, ring: job.rings, next: job.plan.next_fire_at, gave_up: job.plan.gave_up });
  }

  return new Response(JSON.stringify({ ok: true, fired, results }), { headers: { "content-type": "application/json" } });
});
