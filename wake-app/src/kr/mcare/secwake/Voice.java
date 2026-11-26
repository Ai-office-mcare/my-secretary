package kr.mcare.secwake;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * 내 비서 알림이 오면 "일정 왔어 일정 왔어" 목소리를 냅니다 (2026-11-26 대표님 요청).
 * 알림 소리 크기를 따르고, 무음·진동 모드에서는 말하지 않습니다. 이미 말하는 중이면 겹쳐 내지 않습니다.
 * 내 비서가 알림을 조용히 띄운 휴대폰(tag 끝 -voice)에서는 진동도 여기서 냅니다.
 */
final class Voice {
    private static MediaPlayer playing;
    private static long startedAt;

    private Voice() {}

    static boolean enabled(Context c) { return prefs(c).getBoolean("voice", true); }
    static void setEnabled(Context c, boolean on) { prefs(c).edit().putBoolean("voice", on).apply(); }
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("set", Context.MODE_PRIVATE); }

    static int ringer(Context c) { return c.getSystemService(AudioManager.class).getRingerMode(); }

    /** 알림 소리가 날 상황인지: 목소리 켜짐 + 휴대폰이 소리 모드 */
    static boolean allowed(Context c) { return enabled(c) && ringer(c) == AudioManager.RINGER_MODE_NORMAL; }

    static void vibrate(Context c) {
        try {
            Vibrator v = c.getSystemService(Vibrator.class);
            if (v == null || !v.hasVibrator()) return;
            AudioAttributes a = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build();
            v.vibrate(VibrationEffect.createWaveform(new long[] { 0, 500 }, -1), a);
            Log.i(Wake.TAG, "vibrate");
        } catch (RuntimeException e) { Log.w(Wake.TAG, "vibrate failed", e); }
    }

    static void ding(Context c) {
        try {
            android.media.Ringtone r = android.media.RingtoneManager.getRingtone(c, android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION));
            if (r != null) { r.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()); r.play(); }
        } catch (RuntimeException e) { Log.w(Wake.TAG, "ding failed", e); }
    }

    /** @return 진단 기록에 적을 짧은 결과 */
    static String say(Context ctx) {
        // 앞 목소리가 끝났다는 소식을 못 받았더라도 5초가 지났으면 새로 냅니다 (예전엔 여기서 영영 막힐 수 있었음)
        if (playing != null && SystemClock.elapsedRealtime() - startedAt < 5000) { Log.i(Wake.TAG, "voice skipped: already speaking"); return "목소리 이미 나는 중"; }
        if (playing != null) { try { playing.release(); } catch (RuntimeException ignored) { } playing = null; }
        final Context c = ctx.getApplicationContext();
        final AudioManager am = c.getSystemService(AudioManager.class);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        // 음악이 나오고 있으면 잠깐 작게 줄였다가 돌려 놓습니다
        final AudioFocusRequest focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build();
        final MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(attrs);
            mp.setDataSource(c, Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.iljeong));
            mp.setOnCompletionListener(p -> done(p, am, focus));
            mp.setOnErrorListener((p, what, extra) -> { Log.w(Wake.TAG, "voice error " + what); done(p, am, focus); return true; });
            mp.prepare();
            am.requestAudioFocus(focus);
            playing = mp;
            startedAt = SystemClock.elapsedRealtime();
            mp.start();
            Log.i(Wake.TAG, "voice playing");
            return "목소리 냄";
        } catch (Exception e) {
            Log.w(Wake.TAG, "voice failed", e);
            mp.release();
            if (playing == mp) playing = null;
            am.abandonAudioFocusRequest(focus);
            return "목소리 실패(" + e.getClass().getSimpleName() + ")";
        }
    }

    private static void done(MediaPlayer p, AudioManager am, AudioFocusRequest focus) {
        if (playing == p) playing = null;
        try { p.release(); } catch (RuntimeException ignored) { }
        am.abandonAudioFocusRequest(focus);
    }
}
