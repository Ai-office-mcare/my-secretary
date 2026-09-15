// 내 비서 — 알람 보내기 (Supabase Edge Function, 2026-09-15)
//
// ★ 1분마다 pg_cron 이 이 함수를 부릅니다 (supabase/cron.sql). 사람이 직접 부르지 않습니다.
//   · 머리표 x-cron-secret 이 맞아야만 돕니다 (아무나 못 부름)
//   · next_fire_at <= 지금 이고 status 가 todo/doing 이며 notify 가 켜진 것만 고릅니다 (한 번에 최대 50건)
//   · 그 사람의 등록 기기 전부에 웹 푸시. 진동 [400,200,400,200,400] (징·징·징)
//   · 반복이면 next_fire_at 을 다음 회차(한국 시간 기준)로, 아니면 비웁니다. sec_alarm_log 에 기록
//   · 기기가 사라졌다(404/410)고 하면 그 등록을 지웁니다
//
// 비밀값(supabase secrets): VAPID_KEYS_JSON(JWK 두 개) · VAPID_SUBJECT · CRON_SECRET
//   (SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 줍니다)

import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const KST_OFFSET_MIN = 9 * 60;
const MAX_PER_RUN = 50;
const VIBRATE = [400, 200, 400, 200, 400];

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

/** 한국 시간 기준 다음 회차. 없으면 null. */
export function nextFire(current: Date, repeat: Item["repeat"], repeatDays: number[]): Date | null {
  if (repeat === "none") return null;
  // 한국 시간으로 옮겨 계산하고 다시 UTC 로 돌립니다.
  const kst = new Date(current.getTime() + KST_OFFSET_MIN * 60_000);
  const step = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
  let next: Date;
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
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth();
    const day = kst.getUTCDate();
    const lastOfNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
    next = new Date(Date.UTC(y, m + 1, Math.min(day, lastOfNext), kst.getUTCHours(), kst.getUTCMinutes(), 0, 0));
  }
  return new Date(next.getTime() - KST_OFFSET_MIN * 60_000);
}

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

  let fired = 0;
  const results: unknown[] = [];
  for (const item of items as Item[]) {
    const { data: subs } = await db
      .from("sec_push_subscriptions")
      .select("id,endpoint,p256dh,auth,fail_count")
      .eq("user_id", item.user_id);

    const payload = JSON.stringify({
      title: item.title,
      body: item.memo || `${kstText(new Date(item.next_fire_at))} 알람`,
      item_id: item.id,
      tag: `sec-${item.id}`,
      vibrate: VIBRATE,
      url: `#alarm=${item.id}`,
    });

    let sent = 0;
    const detail: string[] = [];
    for (const s of (subs ?? []) as Sub[]) {
      try {
        const subscriber = app.subscribe({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        });
        await subscriber.pushTextMessage(payload, { ttl: 4 * 3600, urgency: webpush.Urgency.High });
        sent++;
        await db.from("sec_push_subscriptions").update({ last_ok_at: now.toISOString(), fail_count: 0 }).eq("id", s.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        detail.push(msg.slice(0, 120));
        const gone = /410|404|not found|gone|expired/i.test(msg);
        if (gone || s.fail_count >= 5) {
          await db.from("sec_push_subscriptions").delete().eq("id", s.id);
        } else {
          await db.from("sec_push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id);
        }
      }
    }

    const next = nextFire(new Date(item.next_fire_at), item.repeat, item.repeat_days ?? []);
    // ★ 다음 회차가 이미 지난 시각이면(오래 꺼져 있던 경우) 지금 이후로 밀어 한꺼번에 쏟아지지 않게 합니다.
    let nextIso: string | null = next ? next.toISOString() : null;
    let guard = 0;
    while (next && nextIso && new Date(nextIso) <= now && guard++ < 400) {
      const n2 = nextFire(new Date(nextIso), item.repeat, item.repeat_days ?? []);
      nextIso = n2 ? n2.toISOString() : null;
    }
    await db
      .from("sec_items")
      .update({ next_fire_at: nextIso, last_fired_at: now.toISOString(), ...(nextIso ? { due_at: nextIso } : {}) })
      .eq("id", item.id);
    await db.from("sec_alarm_log").insert({
      user_id: item.user_id,
      item_id: item.id,
      devices: (subs ?? []).length,
      sent,
      detail: detail.join(" | "),
    });
    fired++;
    results.push({ id: item.id, devices: (subs ?? []).length, sent, next: nextIso });
  }

  return new Response(JSON.stringify({ ok: true, fired, results }), { headers: { "content-type": "application/json" } });
});
