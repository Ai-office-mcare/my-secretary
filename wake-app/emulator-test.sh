#!/usr/bin/env bash
# 가상 휴대폰에서: 화면을 끄고 → 내 비서 모양의 알림을 띄우고 → 화면이 켜지는지
set -uo pipefail
APK="$1"; API="$2"; P=kr.mcare.secwake; FAIL=0
mkdir -p shots
awake() { if [ "$(adb shell dumpsys power | grep -m1 -oE 'mWakefulness=[A-Za-z]+' | cut -d= -f2 | tr -d '\r')" = Awake ]; then echo on; else echo off; fi; }
off() { adb shell input keyevent 223; sleep 4; }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1: got $2, expected $3"; FAIL=1; fi; }
post() { adb shell "cmd notification post -S bigtext -t '$2' '$1' '11/23 15:00 test memo'" >/dev/null; sleep 6; }
shot() { adb exec-out screencap -p > "shots/api$API-$1.png"; }
SEC='p#https://ai-office-mcare.github.io/#0sec-'

adb install -r "$APK" || exit 1
adb shell svc power stayon false
adb shell settings put system screen_off_timeout 60000
adb shell cmd notification allow_listener $P/$P.WakeListener
if [ "$API" -ge 33 ]; then adb shell pm grant $P android.permission.POST_NOTIFICATIONS; fi
adb shell am start -W -n $P/.MainActivity >/dev/null; sleep 3; shot main
adb shell input keyevent 3; sleep 2

off; check "screen starts off" "$(awake)" off
post 'other-app' OTHER;                          check "other notification ignored" "$(awake)" off
post 'p#https://example.com/#0sec-1' OTHERSITE;  check "other site ignored" "$(awake)" off
post "${SEC}1111" ALARM-ONE;                     check "secretary alarm wakes screen" "$(awake)" on
TOP=$(adb shell dumpsys activity activities | grep -E 'ResumedActivity' | head -2); echo "$TOP"
case "$TOP" in *AlarmActivity*) check "alarm screen on top" yes yes;; *) check "alarm screen on top" no yes;; esac
shot alarm
off; sleep 1
post "${SEC}2222" ALARM-TWO;                     check "second alarm wakes again" "$(awake)" on; shot alarm2
sleep 34
TOP=$(adb shell dumpsys activity activities | grep -E 'ResumedActivity' | head -2)
case "$TOP" in *AlarmActivity*) check "alarm screen closes by itself" no yes;; *) check "alarm screen closes by itself" yes yes;; esac

# 알림 표시 권한이 없어도 화면은 켜져야 함 (두 번째 방법)
if [ "$API" -ge 33 ]; then
  adb shell pm revoke $P android.permission.POST_NOTIFICATIONS; sleep 8
  off; check "screen off again" "$(awake)" off
  post "${SEC}3333" ALARM-THREE;                 check "wakes without notification permission" "$(awake)" on; shot fallback
fi
adb logcat -d -s SecWake:V AndroidRuntime:E | tail -40
check "no crash" "$(adb logcat -d -s AndroidRuntime:E | grep -c "Process: $P")" 0
exit $FAIL
