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
title() { adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; if adb shell cat /sdcard/u.xml | grep -q "$1"; then echo yes; else echo no; fi; }
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
adb logcat -c
post "${SEC}1111" ALARM-ONE;                     check "secretary alarm wakes screen" "$(awake)" on
check "voice says 일정 왔어" "$(adb logcat -d -s SecWake:V | grep -c 'voice playing')" 1
adb logcat -c
post "${SEC}5555-quiet" QUIET;                   check "quiet notification has no voice" "$(adb logcat -d -s SecWake:V | grep -c 'voice skipped: quiet')" 1
check "quiet notification not spoken" "$(adb logcat -d -s SecWake:V | grep -c 'voice playing')" 0
adb logcat -c
post "${SEC}6666-voice" VOICEMODE;               check "voice mode speaks" "$(adb logcat -d -s SecWake:V | grep -c 'voice playing')" 1
check "voice mode vibrates" "$(adb logcat -d -s SecWake:V | grep -c 'vibrate$')" 1
TOP=$(adb shell dumpsys activity activities | grep -E 'ResumedActivity' | head -2); echo "$TOP"
case "$TOP" in *AlarmActivity*) check "alarm screen on top" yes yes;; *) check "alarm screen on top" no yes;; esac
shot alarm
post "${SEC}1112" ALARM-ALSO;                    check "overlapping alarm title added" "$(title ALARM-ALSO)" yes; shot also
off; sleep 1
post "${SEC}2222" ALARM-TWO;                     check "second alarm wakes again" "$(awake)" on; shot alarm2
check "second alarm shows its own title" "$(title ALARM-TWO)" yes
check "old title is gone" "$(title ALARM-ONE)" no
sleep 34
TOP=$(adb shell dumpsys activity activities | grep -E 'ResumedActivity' | head -2)
case "$TOP" in *AlarmActivity*) check "alarm screen closes by itself" no yes;; *) check "alarm screen closes by itself" yes yes;; esac

# 잠금 비밀번호가 걸린 상태에서도 잠금화면 위에 떠야 함
adb shell locksettings set-pin 1234; off; sleep 2
check "locked and off" "$(awake)" off
post "${SEC}4444" ALARM-LOCKED;                  check "wakes while PIN locked" "$(awake)" on
check "title shown over PIN lock" "$(title ALARM-LOCKED)" yes; shot locked
adb shell locksettings clear --old 1234; sleep 35

# 알림 표시 권한이 없어도 화면은 켜져야 함 (두 번째 방법)
if [ "$API" -ge 33 ]; then
  adb shell pm revoke $P android.permission.POST_NOTIFICATIONS; sleep 8
  off; check "screen off again" "$(awake)" off
  post "${SEC}3333" ALARM-THREE;                 check "wakes without notification permission" "$(awake)" on; shot fallback
fi
adb logcat -d -s SecWake:V AndroidRuntime:E | tail -40
check "no crash" "$(adb logcat -d -s AndroidRuntime:E | grep -c "Process: $P")" 0
exit $FAIL
