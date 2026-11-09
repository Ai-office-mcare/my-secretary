# 내 비서 — 켜져 있는 곳과 다시 올리는 법 (2026-09-15)

## 지금 켜져 있는 것 (전부 무료)

| 무엇 | 어디 | 확인 |
|---|---|---|
| 앱 화면 | GitHub Pages `https://ai-office-mcare.github.io/my-secretary/` (저장소 `Ai-office-mcare/my-secretary`, 브랜치 main) | 브라우저로 열면 로그인 화면 |
| 자료 | Supabase 프로젝트 **Ai-office** (`nadsaldjxviuvfbzglxl`, 서울) — 표 `sec_items` · `sec_diary` · `sec_push_subscriptions` · `sec_alarm_log`, 전부 RLS(본인 줄만) | 대시보드 → Table Editor |
| 알람 보내기 | Edge Function `sec-send-alarms` (JWT 검증 끔, 대신 `x-cron-secret` 머리표 필요) | 대시보드 → Edge Functions |
| 1분 시계 | pg_cron 작업 `sec-send-alarms-every-minute` (`* * * * *`) → pg_net 으로 함수 호출. 비밀은 Vault `sec_cron_secret` | `select * from cron.job` · `cron.job_run_details` |
| 비밀값 | Supabase secrets: `VAPID_KEYS_JSON`(JWK 두 개) · `VAPID_SUBJECT` · `CRON_SECRET` | `supabase secrets list --project-ref …` |
| 로그인 | Supabase Auth 이메일·비밀번호. **가입 허용 · 이메일 확인 없음**(2026-09-15 에 켬). 화면 주소가 site_url | 대시보드 → Authentication |

★ 2026-09-15 실제로 확인: 19:06 알람을 넣자 클라우드 시계가 **19:06:00** 에 함수를 불러 기록이 남았고, 앱이 열려 있던 화면에는 깜빡임 알람 창이 떴습니다. (기기 등록은 진짜 휴대폰·PC 크롬에서 해야 확인됩니다)

## 화면을 고쳤을 때

```powershell
cd "$env:USERPROFILE\Desktop\내비서"
git add -A; git commit -m "무엇을 고쳤는지"; git push origin main
```
1~2분 뒤 Pages 에 반영됩니다. 휴대폰은 앱을 닫았다 열면 새 판을 받습니다 (서비스워커가 네트워크 우선).

## 알람 함수를 고쳤을 때

### 지금 쓰는 길 (2026-11-09): Claude 앱 안 브라우저의 대시보드

Claude 데스크톱 앱 안 브라우저에 Supabase 가 **GitHub `Ai-office-mcare`** 로 로그인되어 있습니다(대표님이 11-09 에 한 번 로그인, 브라우저가 기억).
크롬의 Supabase 는 업무관리 계정(kjg8961000)이라 Ai-office 가 안 보입니다 — 크롬 계정은 바꾸지 않습니다.
순서: 고친 커밋을 임시 브랜치로 push → 대시보드 Edge Functions → sec-send-alarms → Code 에서 `index.ts`·`plan.js` 를 그 커밋 내용으로 바꿈 →
**Deploy updates → 확인 창의 Deploy updates 한 번 더** → 새로고침해서 코드가 바뀌었는지, Settings 의 Verify JWT 가 꺼져 있는지, Logs 가 1분마다 200 인지 확인 →
그다음 main push(화면). 임시 브랜치는 지움. 로그인이 풀려 있으면 대표님께 그 브라우저에서 다시 로그인만 부탁.

### 자동 배포(준비만 됨): GitHub Actions

`.github/workflows/deploy-alarm-function.yml` — `supabase/functions/` 가 바뀐 main push 때 시험(`tests/plan.test.mjs`)을 돌리고,
저장소 비밀 **`SUPABASE_ACCESS_TOKEN`** 이 있으면 `sec-send-alarms` 를 올립니다. **비밀이 없으면 시험만 하고 배포는 건너뜁니다**(지금 상태).
비밀을 넣으면(Supabase 를 `Ai-office-mcare` 로 로그인 → Account → Access Tokens 에서 만든 값, 사람이 직접 저장소 Settings → Secrets → Actions 에)
그때부터는 main push 한 번에 화면과 함수가 같이 올라갑니다. 손으로 다시 돌리기: 저장소 → Actions → "알람 함수 배포" → Run workflow.

손으로 올릴 때(CLI, 예전 방법):

```powershell
cd "$env:USERPROFILE\Desktop\내비서"
npx --yes supabase@latest functions deploy sec-send-alarms --project-ref nadsaldjxviuvfbzglxl --no-verify-jwt
```
(Supabase CLI 로그인 토큰은 Windows 자격 증명 `Supabase CLI:supabase` 에 있습니다. Docker 는 필요 없습니다.)

★ 2026-10-24: 이 PC 의 CLI 로그인이 다른 Supabase 계정(mcare-rent·Work Plan)으로 바뀌어 위 명령이 403 이 남.
Ai-office 프로젝트는 **Supabase 로그인 화면 → "Continue with GitHub" → GitHub `Ai-office-mcare`** 계정에 있음 (gmail 로그인 아님).
CLI 없이 대시보드로 올려도 됨: Edge Functions → sec-send-alarms → Code → `index.ts`·`plan.js` 내용 바꾸기 → **Deploy updates**.
(이렇게 올려도 Verify JWT 는 꺼진 그대로였음. 올린 뒤 Invocations 에서 1분마다 200 인지 확인)

## 표를 고쳤을 때

`supabase/migrations/*.sql` 에 SQL 을 적고, 관리용 API 로 실행합니다 (CLI `db query` 가 이 프로젝트에서 시간 초과가 나서 관리 API 를 씁니다):
`POST https://api.supabase.com/v1/projects/nadsaldjxviuvfbzglxl/database/query` (Authorization: Bearer <CLI 토큰>, body `{"query": "..."}`).

## 시계를 다시 걸 때

`supabase/cron.sql` 의 `__CRON_SECRET__` 을 실제 비밀(secrets 의 CRON_SECRET 과 같은 값)로 바꿔 위 방법으로 실행합니다. 여러 번 실행해도 안전합니다.

## 문제가 생기면 보는 곳

- 알람이 안 옴 → Supabase 대시보드 → Edge Functions → sec-send-alarms → Logs. 그리고 `select * from sec_alarm_log order by fired_at desc limit 20`
- 시계가 안 돎 → `select * from cron.job_run_details order by start_time desc limit 20`
- 기기 등록 실패 횟수 → 앱 설정 화면 "등록된 기기" (실패 5회면 자동으로 빠집니다)
- 프로젝트 DB 가 "Failed to connect" → 관리 API `POST /v1/projects/<ref>/restart` (2026-09-15 에 한 번 필요했음)

## 한계 (솔직하게)

- 알람 정확도 1분 · 웹 푸시는 안드로이드 크롬 기준(아이폰은 홈 화면에 추가한 뒤) · 푸시 알림음은 기기 기본음
- Supabase 무료 프로젝트는 1주일 무활동이면 잠들지만, 1분 시계가 돌아 잠들지 않습니다
- 가입이 열려 있어 주소를 아는 사람은 계정을 만들 수 있습니다(자료는 서로 안 보임). 닫으려면 Authentication → disable signup

## 시험

```
node --test tests/plan.test.mjs
```
알람 계산(다음 회차 · 10분 뒤 · 1시간마다 반복 · 고치면 멈춤 · 완료/마감 동작) 22개. 서버 함수를 고쳤으면 `functions deploy` 전에 돌린다.
(Node 24 부터는 `node --test tests/` 처럼 폴더만 주면 안 되고 파일 이름을 줘야 합니다.)
