// 설치 파일에 서명 (APK Signature Scheme v2, RSA-2048 + SHA-256). 이 PC 에서만 돌립니다.
//   node wake-app/sign.mjs <unsigned.apk> <out.apk> <열쇠 폴더>
// 열쇠 폴더에 key.pem · cert.pem 이 있어야 합니다. 열쇠는 저장소에 올리지 않습니다 —
// 잃어버리면 다음 판은 휴대폰에서 지우고 다시 설치해야 합니다.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [inFile, outFile, keyDir] = process.argv.slice(2);
const key = crypto.createPrivateKey(fs.readFileSync(path.join(keyDir, "key.pem")));
const cert = new crypto.X509Certificate(fs.readFileSync(path.join(keyDir, "cert.pem")));
const apk = fs.readFileSync(inFile);

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const lp = (...bufs) => { const b = Buffer.concat(bufs); return Buffer.concat([u32(b.length), b]); };
const sha = (b) => crypto.createHash("sha256").update(b).digest();

// ZIP 끝 기록(EOCD) → 중앙 목록 자리
let eocd = apk.length - 22;
while (eocd >= 0 && !(apk.readUInt32LE(eocd) === 0x06054b50 && apk.readUInt16LE(eocd + 20) === apk.length - eocd - 22)) eocd--;
if (eocd < 0) throw new Error("ZIP 파일이 아닙니다");
const cdOff = apk.readUInt32LE(eocd + 16);
const cdSize = apk.readUInt32LE(eocd + 12);
if (cdOff + cdSize !== eocd) throw new Error("ZIP 구조가 예상과 다릅니다 (이미 서명됨?)");

const entries = apk.subarray(0, cdOff), cd = apk.subarray(cdOff, eocd), end = apk.subarray(eocd);

// 내용 지문: 1MB 조각마다, 다시 전체
const chunks = [];
for (const part of [entries, cd, end]) for (let i = 0; i < part.length; i += 1 << 20) {
  const c = part.subarray(i, i + (1 << 20));
  chunks.push(sha(Buffer.concat([Buffer.from([0xa5]), u32(c.length), c])));
}
const digest = sha(Buffer.concat([Buffer.from([0x5a]), u32(chunks.length), ...chunks]));

const ALG = 0x0103; // RSASSA-PKCS1-v1_5 + SHA-256
const signedData = Buffer.concat([lp(lp(u32(ALG), lp(digest))), lp(lp(cert.raw)), lp()]);
const signature = crypto.sign("sha256", signedData, key);
const spki = cert.publicKey.export({ type: "spki", format: "der" });
const signer = lp(lp(signedData), lp(lp(u32(ALG), lp(signature))), lp(spki));
const v2 = lp(signer);

const pair = Buffer.concat([u64(v2.length + 4), u32(0x7109871a), v2]);
const size = pair.length + 8 + 16;
const block = Buffer.concat([u64(size), pair, u64(size), Buffer.from("APK Sig Block 42", "latin1")]);
const newEnd = Buffer.from(end);
newEnd.writeUInt32LE(cdOff + block.length, 16);
fs.writeFileSync(outFile, Buffer.concat([entries, block, cd, newEnd]));
console.log("서명 완료", outFile, "인증서 SHA-256", sha(cert.raw).toString("hex"));
