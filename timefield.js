/* 내 비서 — 시간 직접 입력 칸 (2026-11-23 대표님 요청: 시계 그림 없이 숫자로만)
 *
 * [오전|오후] [시] : [분] 을 눌러 숫자로 넣습니다. 휴대폰 시계 창이 뜨는 <input type="time"> 을 쓰지 않습니다.
 * 값은 숨은 칸(id 그대로)에 "HH:MM"(24시간)으로 들어갑니다. 비었거나 틀린 시간이면 "" 입니다.
 * to24 · from24 는 순수 계산 (시험: node --test tests/timefield.test.mjs)
 */

const pad = (n) => String(n).padStart(2, "0");

/** 오전/오후 + 시 + 분 → "HH:MM". 13~23시를 그대로 넣어도 됩니다. 못 읽으면 "". 분이 비면 00분. */
export function to24(pm, hourText, minText) {
  const ht = String(hourText ?? "").trim(), mt = String(minText ?? "").trim();
  if (!/^\d{1,2}$/.test(ht) || !/^\d{0,2}$/.test(mt)) return "";
  let h = Number(ht);
  const m = mt === "" ? 0 : Number(mt);
  if (h > 23 || m > 59) return "";
  if (h >= 1 && h <= 12) h = (h % 12) + (pm ? 12 : 0); // 오전 12시 = 0시, 오후 12시 = 12시
  return `${pad(h)}:${pad(m)}`;
}

/** "HH:MM" → { pm, hour(1~12), min("00") } */
export function from24(value) {
  const r = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!r) return { pm: false, hour: "", min: "" };
  const h = Number(r[1]);
  return { pm: h >= 12, hour: String(h % 12 || 12), min: r[2] };
}

export function timeField(id, value) {
  const t = from24(value);
  return `<div class="timef" id="${id}-box" role="group" aria-label="시간">
    <div class="ampm">
      <button type="button" data-pm="0" class="${t.pm ? "" : "on"}" aria-pressed="${!t.pm}">오전</button>
      <button type="button" data-pm="1" class="${t.pm ? "on" : ""}" aria-pressed="${t.pm}">오후</button>
    </div>
    <input type="text" class="hh" inputmode="numeric" autocomplete="off" maxlength="2" aria-label="시" value="${t.hour}" />
    <b>:</b>
    <input type="text" class="mm" inputmode="numeric" autocomplete="off" maxlength="2" aria-label="분" value="${t.min}" />
    <input type="hidden" id="${id}" value="${value || ""}" />
  </div>`;
}

/** timeField 로 그린 칸에 동작을 붙입니다. 값이 바뀔 때마다 onChange("HH:MM" 또는 ""). */
export function wireTimeField(id, onChange) {
  const box = document.getElementById(id + "-box");
  const out = document.getElementById(id);
  const hh = box.querySelector(".hh"), mm = box.querySelector(".mm");
  const btns = [...box.querySelectorAll("[data-pm]")];
  let pm = btns[1].classList.contains("on");
  const paint = () => btns.forEach((b) => { const on = (b.dataset.pm === "1") === pm; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  const sync = () => {
    out.value = to24(pm, hh.value, mm.value);
    box.classList.toggle("bad", !out.value);
    if (onChange) onChange(out.value);
  };
  // 칸을 나가면 13~23시·0시를 오전/오후로 바꿔 보여 주고 분을 두 자리로 맞춥니다
  const tidy = () => {
    if (!out.value) return;
    const t = from24(out.value);
    pm = t.pm; hh.value = t.hour; mm.value = t.min; paint();
  };
  btns.forEach((b) => b.onclick = () => { pm = b.dataset.pm === "1"; paint(); sync(); });
  for (const el of [hh, mm]) {
    el.onfocus = () => setTimeout(() => el.select(), 0); // 누르면 바로 새 숫자로 덮어쓰게
    el.onblur = tidy;
    el.oninput = () => {
      el.value = el.value.replace(/\D/g, "");
      sync();
      if (el === hh && hh.value.length === 2) mm.focus(); // 시 두 자리를 넣으면 분으로
    };
    el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (el === hh) mm.focus(); else el.blur(); } };
  }
}
