/* 내 비서 — 앱 본체 (2026-09-15)
 *
 * 화면 4개: 캘린더 · 할 일 · 일기 · 설정. 자료는 Supabase(본인 줄만 보이는 잠금).
 * 알람: 서버(Supabase 1분 시계)가 웹 푸시로 보냅니다. 앱이 열려 있을 때는 이 파일이
 * 30초마다 "지금 울릴 것" 을 확인해 화면을 깜빡이고 소리·진동을 냅니다.
 * 자동 입찰 같은 것은 없습니다. 자료를 몰래 지우지 않습니다(지우기는 언제나 확인을 묻습니다).
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.SEC_CONFIG;
const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const tabs = $("#tabs");
import { RING_SECONDS, afterAction } from "./supabase/functions/sec-send-alarms/plan.js";

const REPEAT_NAMES = { none: "반복 없음", daily: "매일", weekdays: "평일(월~금)", weekly: "매주", monthly: "매월" };
const STATUS_NAMES = { todo: "예정", doing: "진행 중", done: "완료", closed: "마감" };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const VIBRATE = [400, 200, 400, 200, 400];

let user = null;
let tab = "cal";
let calMonth = startOfMonth(new Date());
let selDay = ymd(new Date());
let items = [];
let diaries = {};
let editing = null; // 편집 중인 항목 (null = 없음, {} = 새 항목)
let ringing = new Set(); // 이미 화면에 띄운 알람 id
let flashTimer = null;

// ── 도우미 ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hm(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function whenText(iso) {
  if (!iso) return "날짜 없음";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]}) ${hm(d)}`;
}
function isLate(it) { return it.due_at && new Date(it.due_at) < new Date() && (it.status === "todo" || it.status === "doing"); }
function toast(msg, tone = "good") {
  const el = document.createElement("div");
  el.className = `notice ${tone}`;
  el.style.cssText = "position:fixed;left:12px;right:12px;bottom:76px;z-index:50;box-shadow:0 4px 16px rgba(0,0,0,.15)";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── 로그인 ──────────────────────────────────────────────
function renderAuth(msg = "") {
  tabs.hidden = true;
  main.innerHTML = `
    <div class="auth card">
      <h2 style="margin:0 0 6px">로그인</h2>
      <p class="muted">처음이면 이메일과 비밀번호를 정해 [계정 만들기] 를 누르세요. 본인만 쓰는 공간입니다.</p>
      <label class="f"><span>이메일</span><input id="email" type="email" autocomplete="username" /></label>
      <label class="f" style="margin-top:8px"><span>비밀번호 (6자 이상)</span><input id="pw" type="password" autocomplete="current-password" /></label>
      ${msg ? `<div class="notice bad">${esc(msg)}</div>` : ""}
      <div class="row" style="margin-top:12px">
        <button class="btn" id="login">로그인</button>
        <button class="btn ghost" id="signup">계정 만들기</button>
      </div>
    </div>`;
  $("#login").onclick = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#pw").value });
    if (error) renderAuth(/invalid/i.test(error.message) ? "이메일 또는 비밀번호가 맞지 않습니다." : "로그인하지 못했습니다: " + error.message);
  };
  $("#signup").onclick = async () => {
    const email = $("#email").value.trim(), password = $("#pw").value;
    if (!email || password.length < 6) return renderAuth("이메일과 6자 이상 비밀번호를 넣어 주세요.");
    const { error } = await sb.auth.signUp({ email, password });
    if (error) {
      // ★ 이미 만든 계정이면(한 번 더 눌렀을 때) 만들지 않고 바로 로그인해 봅니다 (2026-09-15 실제로 있었던 일)
      if (/already|exist|registered/i.test(error.message)) {
        const r0 = await sb.auth.signInWithPassword({ email, password });
        if (!r0.error) return;
        return renderAuth("이 이메일로 이미 계정이 있습니다. 처음 정한 비밀번호로 [로그인] 을 눌러 주세요. (비밀번호가 다르면 로그인이 안 됩니다)");
      }
      return renderAuth("계정을 만들지 못했습니다: " + error.message);
    }
    const r = await sb.auth.signInWithPassword({ email, password });
    if (r.error) renderAuth("계정은 만들었지만 로그인하지 못했습니다: " + r.error.message);
  };
}

// ── 자료 ────────────────────────────────────────────────
async function loadAll() {
  const [a, b] = await Promise.all([
    sb.from("sec_items").select("*").order("due_at", { ascending: true, nullsFirst: false }),
    sb.from("sec_diary").select("day,body,updated_at"),
  ]);
  if (a.error) toast("일정을 불러오지 못했습니다: " + a.error.message, "bad");
  if (b.error) toast("일기를 불러오지 못했습니다: " + b.error.message, "bad");
  items = a.data || [];
  diaries = {};
  for (const d of b.data || []) diaries[d.day] = d;
}

async function saveItem(data) {
  const payload = {
    title: data.title.trim(),
    memo: data.memo ?? "",
    due_at: data.due_at,
    repeat: data.repeat,
    repeat_days: data.repeat_days || [],
    notify: !!data.notify,
    status: data.status,
    next_fire_at: data.notify && data.due_at && (data.status === "todo" || data.status === "doing") ? data.due_at : null,
  };
  const q = data.id ? sb.from("sec_items").update(payload).eq("id", data.id) : sb.from("sec_items").insert(payload);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

async function updateItem(id, patch) {
  const it = items.find((x) => x.id === id);
  const merged = { ...it, ...patch };
  await saveItem(merged);
}

async function deleteItem(id) {
  const { error } = await sb.from("sec_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 화면 뼈대 ────────────────────────────────────────────
function setTab(t) {
  tab = t;
  for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === t);
  render();
}
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) setTab(b.dataset.tab);
});

function render() {
  if (!user) return;
  tabs.hidden = false;
  $("#top-right").innerHTML = `<button class="btn ghost small" id="add">+ 추가</button>`;
  $("#add").onclick = () => openEditor({});
  if (editing) return renderEditor();
  if (tab === "cal") renderCal();
  else if (tab === "todo") renderTodo();
  else if (tab === "diary") renderDiary();
  else renderSettings();
}

// ── 캘린더 ──────────────────────────────────────────────
function renderCal() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));
  const byDay = {};
  for (const it of items) if (it.due_at) { const k = ymd(new Date(it.due_at)); (byDay[k] ||= []).push(it); }
  const today = ymd(new Date());

  main.innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn ghost small" id="prev">‹ 지난달</button>
        <h2>${y}년 ${m + 1}월</h2>
        <button class="btn ghost small" id="next">다음달 ›</button>
      </div>
      <div class="cal">
        ${DOW.map((d, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("")}
        ${cells.map((d) => {
          if (!d) return `<div></div>`;
          const k = ymd(d);
          const list = byDay[k] || [];
          const dots = list.slice(0, 4).map((it) => `<span class="dot ${it.status === "done" || it.status === "closed" ? "done" : ""}"></span>`).join("") + (diaries[k]?.body ? `<span class="dot diary"></span>` : "");
          return `<button class="day ${k === today ? "today" : ""} ${k === selDay ? "sel" : ""}" data-day="${k}">
            <span class="n ${d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : ""}">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
        }).join("")}
      </div>
      <p class="muted" style="margin:8px 0 0">주황 점 = 일정 · 초록 점 = 완료 · 파랑 점 = 일기</p>
    </div>
    <div class="card">
      <div class="row between">
        <h3 style="margin:0">${selDay.slice(5).replace("-", "/")} 일정</h3>
        <button class="btn small" id="add-day">+ 이날 일정</button>
      </div>
      <div id="day-list" style="margin-top:8px"></div>
      <h3 style="margin:14px 0 6px">이날 일기</h3>
      <textarea id="diary-quick" placeholder="오늘 있었던 일, 생각을 적어 두세요. 자동 저장됩니다.">${esc(diaries[selDay]?.body || "")}</textarea>
      <p class="muted" id="diary-state">${diaries[selDay]?.updated_at ? "저장됨 " + whenText(diaries[selDay].updated_at) : ""}</p>
    </div>`;
  $("#prev").onclick = () => { calMonth = new Date(y, m - 1, 1); render(); };
  $("#next").onclick = () => { calMonth = new Date(y, m + 1, 1); render(); };
  for (const b of main.querySelectorAll(".day")) b.onclick = () => { selDay = b.dataset.day; render(); };
  $("#add-day").onclick = () => openEditor({ due_at: new Date(selDay + "T09:00:00").toISOString() });
  renderItemList($("#day-list"), (byDay[selDay] || []), "이날 일정이 없습니다.");
  wireDiary($("#diary-quick"), $("#diary-state"), selDay);
}

// ── 일정 목록 (공통) ─────────────────────────────────────
function renderItemList(el, list, emptyText) {
  if (!list.length) { el.innerHTML = `<p class="muted">${emptyText}</p>`; return; }
  el.innerHTML = list.map((it) => `
    <div class="item ${it.status === "done" || it.status === "closed" ? "done" : ""}" data-id="${it.id}">
      <div class="row between">
        <span class="t">${esc(it.title)}</span>
        <span class="pill ${it.status}">${STATUS_NAMES[it.status]}</span>
      </div>
      ${it.memo ? `<div class="m">${esc(it.memo)}</div>` : ""}
      <div class="when ${isLate(it) ? "late" : ""}">${it.due_at ? "⏰ " + whenText(it.due_at) : "날짜 없음"}${it.repeat !== "none" ? " · " + REPEAT_NAMES[it.repeat] : ""}${it.notify === false ? " · 알림 꺼짐" : ""}</div>
      <div class="row" style="margin-top:6px">
        ${it.status !== "done" ? `<button class="btn ghost small" data-act="done">완료</button>` : `<button class="btn ghost small" data-act="todo">다시 예정</button>`}
        ${it.status !== "doing" && it.status !== "done" ? `<button class="btn ghost small" data-act="doing">진행 중</button>` : ""}
        ${it.status !== "closed" ? `<button class="btn ghost small" data-act="closed">마감</button>` : ""}
        <button class="btn ghost small" data-act="snooze">날짜 바꾸기</button>
        <button class="btn ghost small" data-act="edit">고치기</button>
        <button class="btn danger small" data-act="del">지우기</button>
      </div>
    </div>`).join("");
  el.onclick = async (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.closest(".item").dataset.id;
    const it = items.find((x) => x.id === id);
    try {
      if (b.dataset.act === "edit") return openEditor(it);
      if (b.dataset.act === "del") {
        if (!confirm(`'${it.title}' 을(를) 지울까요? 되돌릴 수 없습니다.`)) return;
        await deleteItem(id);
      } else if (b.dataset.act === "snooze") {
        return openSnooze(it);
      } else {
        await updateItem(id, { status: b.dataset.act });
      }
      await loadAll(); render(); toast("저장했습니다.");
    } catch (err) { toast("저장하지 못했습니다: " + err.message, "bad"); }
  };
}

// ── 날짜 바꾸기 (진행 → 미루기) ───────────────────────────
function openSnooze(it, afterAlarm = false) {
  const box = $("#alarm-modal");
  box.classList.remove("hidden");
  const base = it.due_at ? new Date(it.due_at) : new Date();
  box.innerHTML = `<div class="box" style="border-color:var(--accent)">
    <h2>${esc(it.title)}</h2>
    <p class="muted">언제로 바꿀까요? (지금 ${whenText(it.due_at)})</p>
    <div class="btns">
      <button class="btn ghost" data-min="60">1시간 뒤</button>
      <button class="btn ghost" data-min="180">3시간 뒤</button>
      <button class="btn ghost" data-day="1">내일 같은 시각</button>
      <button class="btn ghost" data-day="7">일주일 뒤</button>
    </div>
    <div class="grid2" style="margin-top:10px">
      <label class="f"><span>날짜</span><input type="date" id="sn-date" value="${ymd(base)}"></label>
      <label class="f"><span>시간</span><input type="time" id="sn-time" value="${hm(base)}"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="sn-ok">이 날짜로 (진행 중)</button>
      <button class="btn ghost" id="sn-cancel">닫기</button>
    </div>
  </div>`;
  const apply = async (d) => {
    try {
      await updateItem(it.id, { due_at: d.toISOString(), status: "doing" });
      box.classList.add("hidden"); stopFlash();
      await loadAll(); render(); toast("날짜를 바꿨습니다: " + whenText(d.toISOString()));
    } catch (err) { toast("바꾸지 못했습니다: " + err.message, "bad"); }
  };
  box.querySelectorAll("[data-min]").forEach((b) => b.onclick = () => apply(new Date(Date.now() + Number(b.dataset.min) * 60000)));
  box.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => { const d = new Date(base); d.setDate(d.getDate() + Number(b.dataset.day)); if (d < new Date()) d.setTime(Date.now() + 86400000); apply(d); });
  $("#sn-ok").onclick = () => apply(new Date(`${$("#sn-date").value}T${$("#sn-time").value || "09:00"}:00`));
  $("#sn-cancel").onclick = () => { box.classList.add("hidden"); stopFlash(); };
}

// ── 편집 ────────────────────────────────────────────────
function openEditor(it) { editing = { ...it }; render(); }
function renderEditor() {
  const it = editing;
  const d = it.due_at ? new Date(it.due_at) : null;
  const days = it.repeat_days || [];
  main.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 10px">${it.id ? "일정 고치기" : "새 일정 · 알람"}</h2>
      <label class="f"><span>제목 *</span><input type="text" id="e-title" value="${esc(it.title || "")}" placeholder="예: 거래처 전화" /></label>
      <label class="f" style="margin-top:8px"><span>메시지 (알람에 함께 나옵니다)</span><textarea id="e-memo" placeholder="예: 김 사장님께 계약서 확인 요청">${esc(it.memo || "")}</textarea></label>
      <div class="grid2" style="margin-top:8px">
        <label class="f"><span>날짜</span><input type="date" id="e-date" value="${d ? ymd(d) : selDay}" /></label>
        <label class="f"><span>시간</span><input type="time" id="e-time" value="${d ? hm(d) : "09:00"}" /></label>
      </div>
      <label class="f" style="margin-top:8px"><span>반복</span>
        <select id="e-repeat">${Object.entries(REPEAT_NAMES).map(([k, v]) => `<option value="${k}" ${(it.repeat || "none") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <div id="e-days" class="chips" style="margin-top:8px; ${(it.repeat || "none") === "weekly" ? "" : "display:none"}">
        ${DOW.map((n, i) => `<button type="button" class="chip ${days.includes(i) ? "on" : ""}" data-d="${i}">${n}</button>`).join("")}
      </div>
      <div class="grid2" style="margin-top:8px">
        <label class="f"><span>상태</span>
          <select id="e-status">${Object.entries(STATUS_NAMES).map(([k, v]) => `<option value="${k}" ${(it.status || "todo") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </label>
        <label class="f"><span>알림</span>
          <select id="e-notify"><option value="1" ${it.notify !== false ? "selected" : ""}>그 시간에 알림</option><option value="0" ${it.notify === false ? "selected" : ""}>알림 없음</option></select>
        </label>
      </div>
      <div id="e-err"></div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="e-save">저장</button>
        <button class="btn ghost" id="e-cancel">취소</button>
        ${it.id ? `<button class="btn danger" id="e-del">지우기</button>` : ""}
      </div>
    </div>`;
  $("#e-repeat").onchange = (e) => { $("#e-days").style.display = e.target.value === "weekly" ? "" : "none"; };
  $("#e-days").onclick = (e) => { const b = e.target.closest(".chip"); if (b) b.classList.toggle("on"); };
  $("#e-cancel").onclick = () => { editing = null; render(); };
  if (it.id) $("#e-del").onclick = async () => {
    if (!confirm(`'${it.title}' 을(를) 지울까요? 되돌릴 수 없습니다.`)) return;
    try { await deleteItem(it.id); editing = null; await loadAll(); render(); toast("지웠습니다."); } catch (err) { $("#e-err").innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
  };
  $("#e-save").onclick = async () => {
    const title = $("#e-title").value.trim();
    if (!title) return ($("#e-err").innerHTML = `<div class="notice bad">제목을 넣어 주세요.</div>`);
    const date = $("#e-date").value, time = $("#e-time").value || "09:00";
    const due = date ? new Date(`${date}T${time}:00`).toISOString() : null;
    const repeat = $("#e-repeat").value;
    const repeat_days = [...$("#e-days").querySelectorAll(".chip.on")].map((b) => Number(b.dataset.d));
    try {
      await saveItem({ id: it.id, title, memo: $("#e-memo").value, due_at: due, repeat, repeat_days, status: $("#e-status").value, notify: $("#e-notify").value === "1" });
      editing = null; if (date) selDay = date;
      await loadAll(); render(); toast(due && $("#e-notify").value === "1" ? "저장했습니다. " + whenText(due) + " 에 알림이 갑니다." : "저장했습니다.");
    } catch (err) { $("#e-err").innerHTML = `<div class="notice bad">저장하지 못했습니다: ${esc(err.message)}</div>`; }
  };
}

// ── 할 일 ──────────────────────────────────────────────
function renderTodo() {
  const open = items.filter((i) => i.status === "todo" || i.status === "doing").sort((a, b) => (a.due_at || "9") > (b.due_at || "9") ? 1 : -1);
  const late = open.filter(isLate);
  const closed = items.filter((i) => i.status === "done" || i.status === "closed").sort((a, b) => (a.due_at || "") < (b.due_at || "") ? 1 : -1).slice(0, 30);
  main.innerHTML = `
    ${late.length ? `<div class="notice bad">지난 일정 ${late.length}건이 있습니다. 완료·마감하거나 날짜를 바꿔 주세요.</div>` : ""}
    <div class="card"><h3 style="margin:0 0 8px">해야 할 일 ${open.length}건</h3><div id="open"></div></div>
    <div class="card"><h3 style="margin:0 0 8px">끝난 일 (최근 30건)</h3><div id="closed"></div></div>`;
  renderItemList($("#open"), open, "해야 할 일이 없습니다. 위 [+ 추가] 로 넣어 두세요.");
  renderItemList($("#closed"), closed, "아직 없습니다.");
}

// ── 일기 ──────────────────────────────────────────────
function renderDiary() {
  const days = Object.keys(diaries).filter((k) => diaries[k].body).sort().reverse();
  main.innerHTML = `
    <div class="card">
      <div class="grid2"><label class="f"><span>날짜</span><input type="date" id="d-day" value="${selDay}"></label></div>
      <textarea id="d-body" style="min-height:220px;margin-top:8px" placeholder="오늘의 일기. 자동 저장됩니다.">${esc(diaries[selDay]?.body || "")}</textarea>
      <p class="muted" id="d-state">${diaries[selDay]?.updated_at ? "저장됨 " + whenText(diaries[selDay].updated_at) : ""}</p>
    </div>
    <div class="card"><h3 style="margin:0 0 8px">지난 일기</h3>
      ${days.length ? days.slice(0, 60).map((k) => `<div class="item" data-day="${k}"><div class="t">${k}</div><div class="m">${esc(diaries[k].body.slice(0, 120))}${diaries[k].body.length > 120 ? "…" : ""}</div></div>`).join("") : `<p class="muted">아직 쓴 일기가 없습니다.</p>`}
    </div>`;
  $("#d-day").onchange = (e) => { selDay = e.target.value; render(); };
  wireDiary($("#d-body"), $("#d-state"), selDay);
  main.querySelectorAll(".item[data-day]").forEach((el) => el.onclick = () => { selDay = el.dataset.day; render(); });
}
function wireDiary(ta, state, day) {
  let t = null;
  ta.oninput = () => {
    state.textContent = "저장 중...";
    clearTimeout(t);
    t = setTimeout(async () => {
      const body = ta.value;
      const { error } = await sb.from("sec_diary").upsert({ day, body, user_id: user.id }, { onConflict: "user_id,day" });
      if (error) { state.textContent = "저장하지 못했습니다: " + error.message; state.className = "notice bad"; return; }
      diaries[day] = { day, body, updated_at: new Date().toISOString() };
      state.className = "muted"; state.textContent = "저장됨 " + whenText(diaries[day].updated_at);
    }, 800);
  };
}

// ── 설정 · 알림 받기 ──────────────────────────────────────
async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { ok: false, why: "이 브라우저는 푸시 알림을 지원하지 않습니다. 안드로이드 크롬으로 열어 주세요." };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { ok: true, sub, perm: Notification.permission };
}
function b64ToU8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("알림 권한을 허용해 주셔야 합니다.");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.vapidPublicKey) });
  const j = sub.toJSON();
  const label = /Android/i.test(navigator.userAgent) ? "안드로이드" : /iPhone|iPad/i.test(navigator.userAgent) ? "아이폰" : "PC";
  const { error } = await sb.from("sec_push_subscriptions").upsert(
    { user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: label + " " + (navigator.userAgent.match(/Chrome\/\d+|Safari\/\d+/) || [""])[0] },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw new Error(error.message);
}
// 서비스워커가 적어 둔 수신 기록 읽기 (진단)
function readReceipts() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("sec-diag", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("receipts", { autoIncrement: true });
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction("receipts").objectStore("receipts").getAll();
        req.onsuccess = () => { db.close(); resolve((req.result || []).slice(-30).reverse()); };
        req.onerror = () => resolve([]);
      };
    } catch { resolve([]); }
  });
}

async function renderSettings() {
  const st = await pushState();
  const receipts = await readReceipts();
  const { data: devices } = await sb.from("sec_push_subscriptions").select("id,label,created_at,last_ok_at,fail_count").order("created_at");
  const { data: logs } = await sb.from("sec_alarm_log").select("fired_at,devices,sent,detail").order("fired_at", { ascending: false }).limit(10);
  const mine = st.sub ? (devices || []).find((d) => d.endpoint === st.sub.endpoint) : null;
  main.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 6px">이 기기에서 알림 받기</h3>
      ${!st.ok ? `<div class="notice warn">${esc(st.why)}</div>` : `
        <p class="muted">${st.sub ? "이 기기는 등록돼 있습니다. 앱을 닫아도 알람이 옵니다." : "아직 등록되지 않았습니다. 아래 단추를 누르고 알림을 허용해 주세요."}</p>
        <div class="row">
          <button class="btn" id="p-on">${st.sub ? "다시 등록" : "이 기기에서 알림 받기"}</button>
          <button class="btn ghost" id="p-test" ${st.sub ? "" : "disabled"}>시험 알림 (1분 안에)</button>
        </div>
        <p class="muted" style="margin-top:6px">휴대폰: 진동 징·징·징 3번 + 기본 알림음. PC: 크롬 알림 + 앱이 열려 있으면 화면 깜빡임과 소리.</p>`}
    </div>
    <div class="card"><h3 style="margin:0 0 6px">등록된 기기 ${(devices || []).length}대</h3>
      ${(devices || []).map((d) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(d.label || "기기")} <span class="muted">${d.last_ok_at ? "마지막 성공 " + whenText(d.last_ok_at) : ""}${d.fail_count ? " · 실패 " + d.fail_count : ""}</span></span><button class="btn danger small" data-dev="${d.id}">빼기</button></div>`).join("") || `<p class="muted">없음</p>`}
    </div>
    <div class="card"><h3 style="margin:0 0 6px">이 기기가 받은 알림 기록 <span class="muted" style="font-weight:normal">(진단용)</span></h3>
      <p class="muted">서버가 보낸 시각(아래 "최근 울린 기록")과 견줘 보세요. 화면이 꺼진 동안 받았으면 시각이 같고, 화면을 켤 때야 받았으면 늦습니다.</p>
      ${receipts.map((r) => `<div class="muted">${new Date(r.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${esc(String(r.title || ""))}${r.pulse > 1 ? ` (${r.pulse}/4)` : ""}</div>`).join("") || `<p class="muted">아직 이 기기가 받은 알림이 없습니다 (새 판을 받은 뒤부터 기록됩니다)</p>`}
    </div>
    <div class="card"><h3 style="margin:0 0 6px">최근 울린 기록 <span class="muted" style="font-weight:normal">(서버가 보낸 시각)</span></h3>
      ${(logs || []).map((l) => `<div class="muted">${new Date(l.fired_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · 기기 ${l.devices}대 중 ${l.sent}대 성공${l.detail ? " · " + esc(l.detail.slice(0, 80)) : ""}</div>`).join("") || `<p class="muted">아직 없음</p>`}
    </div>
    <div class="card">
      <p class="muted">${esc(user.email)}</p>
      <div class="row"><button class="btn ghost" id="logout">로그아웃</button><button class="btn ghost" id="pw">비밀번호 바꾸기</button></div>
    </div>`;
  if (st.ok) {
    $("#p-on").onclick = async () => { try { await subscribePush(); toast("등록했습니다. 앱을 닫아도 알람이 옵니다."); render(); } catch (e) { toast(e.message, "bad"); } };
    $("#p-test").onclick = async () => {
      try {
        await saveItem({ title: "시험 알림", memo: "이 알림이 오면 준비 끝입니다.", due_at: new Date(Date.now() + 20000).toISOString(), repeat: "none", repeat_days: [], status: "todo", notify: true });
        toast("1분 안에 시험 알림이 옵니다. 앱을 닫아 두고 기다려 보세요."); await loadAll();
      } catch (e) { toast(e.message, "bad"); }
    };
  }
  main.querySelectorAll("[data-dev]").forEach((b) => b.onclick = async () => { if (!confirm("이 기기를 알림에서 뺄까요?")) return; await sb.from("sec_push_subscriptions").delete().eq("id", b.dataset.dev); render(); });
  $("#logout").onclick = async () => { await sb.auth.signOut(); };
  $("#pw").onclick = async () => {
    const p = prompt("새 비밀번호 (6자 이상)"); if (!p || p.length < 6) return;
    const { error } = await sb.auth.updateUser({ password: p }); toast(error ? "바꾸지 못했습니다: " + error.message : "비밀번호를 바꿨습니다.", error ? "bad" : "good");
  };
}

// ── 앱이 열려 있을 때의 알람 (깜빡임 · 소리 · 진동) ────────────
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const play = (t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.35); o.start(t); o.stop(t + 0.4); };
    play(ctx.currentTime); play(ctx.currentTime + 0.5); play(ctx.currentTime + 1.0);
  } catch { /* 소리를 못 내는 환경 */ }
}
// ★ 알람시계 방식 (2026-09-20): 한 번에 20초 울리고 멈춥니다. 처리하지 않으면 서버가 5분 뒤 다시 보내고, 그때 또 20초.
let flashStop = null;
function startFlash() {
  document.body.classList.add("flash");
  clearInterval(flashTimer); clearTimeout(flashStop);
  const ring = () => { beep(); if (navigator.vibrate) navigator.vibrate(VIBRATE); };
  ring();
  flashTimer = setInterval(ring, 3000);
  flashStop = setTimeout(stopFlash, RING_SECONDS * 1000);
}
function stopFlash() { document.body.classList.remove("flash"); clearInterval(flashTimer); clearTimeout(flashStop); flashTimer = null; }

function showAlarm(it, fromPush = false, ring = 1) {
  ringing.add(it.id);
  const box = $("#alarm-modal");
  box.classList.remove("hidden");
  box.innerHTML = `<div class="box">
    <h2>⏰ ${esc(it.title)}${ring > 1 ? ` <small>(${ring}번째 알림)</small>` : ""}</h2>
    <div class="m">${esc(it.memo || whenText(it.due_at))}</div>
    <div class="btns">
      <button class="btn" data-a="done">완료</button>
      <button class="btn ghost" data-a="doing">진행 중 (날짜 바꾸기)</button>
      <button class="btn ghost" data-a="closed">마감</button>
      <button class="btn ghost" data-a="later">1시간 뒤 다시</button>
    </div>
    <p class="muted" style="margin:10px 0 0">${fromPush ? "알림에서 열었습니다." : "지금 시각이 되어 울립니다."} 완료·마감·날짜 바꾸기를 안 하면 <b>5분마다</b> 다시 울립니다 (최대 1시간).</p>
  </div>`;
  if (!fromPush) startFlash();
  box.onclick = async (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const a = b.dataset.a;
    try {
      if (a === "doing") { stopFlash(); return openSnooze(it, true); }
      // ★ 반복 알람의 [완료] 는 "오늘 것 끝" — 다음 회차로 넘기고 계속 예정 (plan.js afterAction)
      const patch = afterAction(a, it, new Date());
      await updateItem(it.id, patch);
      box.classList.add("hidden"); stopFlash(); ringing.delete(it.id);
      await loadAll(); render();
      toast(a === "done" && patch.status === "todo" ? "완료. 다음은 " + whenText(patch.due_at) + " 에 울립니다." : "처리했습니다.");
    } catch (err) { toast("처리하지 못했습니다: " + err.message, "bad"); }
  };
}
const rungFor = {}; // id → 마지막으로 울린 서버 발송 시각 (5분마다 다시 울리기 위해)
async function checkDue() {
  if (!user) return;
  const now = Date.now();
  for (const it of items) {
    if (!it.due_at || it.notify === false || (it.status !== "todo" && it.status !== "doing")) continue;
    const t = new Date(it.due_at).getTime();
    // 지금 시각 ±5분 안에 든 것만 울립니다 (오래 지난 것은 목록의 '지난 일정' 으로)
    if (t <= now && now - t < 5 * 60000 && !ringing.has(it.id)) { rungFor[it.id] = it.last_fired_at || null; showAlarm(it); return; }
    // ★ 서버가 다시 울렸으면(5분마다) 푸시가 안 오는 기기(PC 등)에서도 여기서 다시 웁니다.
    const fired = it.last_fired_at ? new Date(it.last_fired_at).getTime() : 0;
    if (fired && now - fired < 90000 && rungFor[it.id] !== it.last_fired_at) {
      rungFor[it.id] = it.last_fired_at;
      const ring = Math.max(1, Math.round((now - t) / (5 * 60000)) + 1);
      showAlarm(it, false, ring); return;
    }
  }
}
async function handleHash() {
  const m = location.hash.match(/alarm=([0-9a-f-]+)(?:&do=(\w+))?/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);
  await loadAll();
  const it = items.find((x) => x.id === m[1]);
  if (!it) return;
  if (m[2] === "done") { const p = afterAction("done", it, new Date()); await updateItem(it.id, p); await loadAll(); render(); return toast(p.status === "todo" ? "완료. 다음은 " + whenText(p.due_at) + " 에 울립니다." : "완료로 표시했습니다."); }
  if (m[2] === "snooze") { await updateItem(it.id, afterAction("later", it, new Date())); await loadAll(); render(); return toast("1시간 뒤로 미뤘습니다."); }
  showAlarm(it, true);
}

// ── 시작 ──────────────────────────────────────────────
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => null);
  sb.auth.onAuthStateChange(async (_ev, session) => {
    user = session?.user || null;
    if (!user) return renderAuth();
    $("#sub").textContent = "업무지시 · 알람 · 캘린더 · 일기장";
    await loadAll(); render(); await handleHash(); checkDue();
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) renderAuth();
  setInterval(async () => { if (user && !editing) { await loadAll(); if (tab !== "settings") render(); checkDue(); } }, 30000);
  window.addEventListener("hashchange", handleHash);
  // 서비스워커가 푸시를 받았을 때 — 앱이 열려 있으면 여기서도 소리·진동·깜빡임 (2026-09-15 대표님 요청 "진동과 소리 같이")
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", async (e) => {
    if (!e.data || e.data.type !== "alarm" || !user) return;
    await loadAll();
    const it = items.find((x) => x.id === e.data.item_id);
    // 서버는 한 번 울릴 때 6초 간격으로 4번 보냅니다(휴대폰용). 앱은 첫 번째에만 20초 울림을 시작하고 나머지는 무시합니다.
    if ((e.data.pulse || 1) > 1 && it && ringing.has(it.id)) return;
    if (it) { rungFor[it.id] = it.last_fired_at || null; showAlarm(it, false, e.data.ring || 1); } // 이미 떠 있어도 다시 20초 웁니다 (N번째)
    else { beep(); if (navigator.vibrate) navigator.vibrate(VIBRATE); }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && user) { loadAll().then(() => { render(); checkDue(); }); } });
}
boot();
