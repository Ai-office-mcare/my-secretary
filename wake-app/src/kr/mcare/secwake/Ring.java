package kr.mcare.secwake;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * 내 비서 알림이 올 때 함께 내는 진동(과 필요할 때 기본 알림음).
 * 소리는 휴대폰 기본 알림음이 냅니다 ("일정 왔어" 목소리는 2026-11-27 대표님 요청으로 없앰).
 */
final class Ring {
    private Ring() {}

    static int ringer(Context c) { return c.getSystemService(AudioManager.class).getRingerMode(); }

    static void vibrate(Context c) {
        try {
            Vibrator v = c.getSystemService(Vibrator.class);
            if (v == null || !v.hasVibrator()) return;
            // 알람 종류로 냅니다: 알림 종류는 "소리 모드에서는 진동 안 함" 설정에 막힐 수 있음 (무음·방해 금지는 WakeListener 가 먼저 거름)
            AudioAttributes a = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
            v.vibrate(VibrationEffect.createWaveform(new long[] { 0, 400, 150, 400 }, -1), a);
            Log.i(Wake.TAG, "vibrate");
        } catch (RuntimeException e) { Log.w(Wake.TAG, "vibrate failed", e); }
    }

    /** 휴대폰 기본 알림음 — 예전 판 내 비서가 알림을 소리 없이 띄운 경우에만 씁니다 */
    static void ding(Context c) {
        try {
            android.media.Ringtone r = RingtoneManager.getRingtone(c, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            if (r != null) { r.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()); r.play(); Log.i(Wake.TAG, "ding"); }
        } catch (RuntimeException e) { Log.w(Wake.TAG, "ding failed", e); }
    }
}
