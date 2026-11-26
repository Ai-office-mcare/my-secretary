#!/usr/bin/env bash
# 서명 안 된 설치 파일 만들기 → out/unsigned.apk (GitHub Actions 에서 돕니다)
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:?}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | grep -E '^[0-9.]+$' | sort -V | tail -1)"
JAR="$SDK/platforms/android-34/android.jar"
if [ ! -f "$JAR" ]; then (yes || true) | "$SDK/cmdline-tools/latest/bin/sdkmanager" "platforms;android-34" >/dev/null; fi
rm -rf out && mkdir -p out/classes out/gen
"$BT/aapt2" compile --dir res -o out/res.zip
"$BT/aapt2" link -o out/base.apk -I "$JAR" --manifest AndroidManifest.xml --java out/gen \
  --min-sdk-version 26 --target-sdk-version 33 --version-code 3 --version-name 1.2 out/res.zip
javac --release 11 -encoding UTF-8 -cp "$JAR" -d out/classes $(find src out/gen -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$JAR" --output out $(find out/classes -name '*.class')
(cd out && zip -qj base.apk classes.dex)
"$BT/zipalign" -f -p 4 out/base.apk out/unsigned.apk
"$BT/aapt2" dump badging out/unsigned.apk | grep -E "^(package|uses-permission|application-label|targetSdk)"
