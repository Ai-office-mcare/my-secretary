// 시간 직접 입력 칸 계산 시험 — node --test tests/timefield.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { from24, to24 } from "../timefield.js";

test("오전·오후 — 12시 경계", () => {
  assert.equal(to24(false, "9", "00"), "09:00");
  assert.equal(to24(true, "9", "05"), "21:05");
  assert.equal(to24(false, "12", "30"), "00:30");
  assert.equal(to24(true, "12", "30"), "12:30");
});

test("13~23시와 0시는 오전·오후와 상관없이 그대로", () => {
  assert.equal(to24(false, "15", "20"), "15:20");
  assert.equal(to24(true, "23", "59"), "23:59");
  assert.equal(to24(true, "0", "10"), "00:10");
});

test("분이 비면 00분, 한 자리면 그 분", () => {
  assert.equal(to24(false, "7", ""), "07:00");
  assert.equal(to24(false, "7", "5"), "07:05");
});

test("못 읽는 시간은 빈 값 — 엉뚱한 시각으로 저장하지 않는다", () => {
  for (const [h, m] of [["", "10"], ["24", "00"], ["9", "60"], ["99", "99"], ["a", "0"], ["", ""]]) assert.equal(to24(false, h, m), "");
});

test("하루 모든 시각이 바꿨다 돌려도 같다", () => {
  for (let i = 0; i < 1440; i++) {
    const v = `${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
    const t = from24(v);
    assert.equal(to24(t.pm, t.hour, t.min), v);
  }
});
