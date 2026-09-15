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

```powershell
cd "$env:USERPROFILE\Desktop\내비서"
npx --yes supabase@latest functions deploy sec-send-alarms --project-ref nadsaldjxviuvfbzglxl --no-verify-jwt
```
(Supabase CLI 로그인 토큰은 Windows 자격 증명 `Supabase CLI:supabase` 에 있습니다. Docker 는 필요 없습니다.)

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
