// 다듬기 → (f배 빠르게 재생, 1 이면 그대로) → 앞뒤 부드럽게 → 두 번 이어 붙이기
import fs from "node:fs";
const [inp, out, f = "1.3"] = process.argv.slice(2), F = Number(f);
const b = fs.readFileSync(inp); let p = 12, fmt, data;
while (p < b.length) { const id = b.toString("latin1", p, p + 4), n = b.readUInt32LE(p + 4); if (id === "fmt ") fmt = b.subarray(p + 8, p + 8 + n); if (id === "data") data = b.subarray(p + 8, p + 8 + n); p += 8 + n + (n & 1); }
const rate = fmt.readUInt32LE(4), s = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
let a = 0, z = s.length - 1; const th = peak * 0.02;
while (a < z && Math.abs(s[a]) < th) a++; while (z > a && Math.abs(s[z]) < th) z--;
const cut = s.subarray(Math.max(0, a - 300), Math.min(s.length, z + 900));
const up = new Float32Array(Math.floor(cut.length / F));
for (let i = 0; i < up.length; i++) { const x = i * F, k = Math.floor(x), t = x - k; up[i] = cut[k] * (1 - t) + (cut[k + 1] ?? cut[k]) * t; }
// 앞뒤 10ms 를 부드럽게 (잘린 자리에서 '틱' 소리가 나지 않게)
const fade = Math.round(rate * 0.01); for (let i = 0; i < fade; i++) { up[i] *= i / fade; up[up.length - 1 - i] *= i / fade; }
const gap = Math.round(rate * 0.12), o = new Int16Array(up.length * 2 + gap), g = 29000 / peak;
for (let i = 0; i < up.length; i++) { o[i] = Math.round(up[i] * g); o[up.length + gap + i] = Math.round(up[i] * g); }
const body = Buffer.from(o.buffer), h = Buffer.alloc(44);
h.write("RIFF", 0, "latin1"); h.writeUInt32LE(36 + body.length, 4); h.write("WAVEfmt ", 8, "latin1"); h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write("data", 36, "latin1"); h.writeUInt32LE(body.length, 40);
fs.writeFileSync(out, Buffer.concat([h, body]));
console.log("one", (up.length / rate).toFixed(2), "s · total", (o.length / rate).toFixed(2), "s · bytes", 44 + body.length);
