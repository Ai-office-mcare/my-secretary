package kr.mcare.secwake;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.util.Log;

/**
 * 내 비서 알림이 오면 "일정왔어 일정왔어" 목소리를 냅니다 (2026-11-26 대표님 요청).
 * 알림 소리 크기를 따르고, 무음·진동 모드에서는 내지 않습니다. 이미 말하는 중이면 겹쳐 내지 않습니다.
 */
final class Voice {
    private static MediaPlayer playing;

    private Voice() {}

    static boolean enabled(Context c) { return prefs(c).getBoolean("voice", true); }
    static void setEnabled(Context c, boolean on) { prefs(c).edit().putBoolean("voice", on).apply(); }
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("set", Context.MODE_PRIVATE); }

    /** 알림 소리가 날 상황인지: 목소리 켜짐 + 휴대폰이 소리 모드 */
    static boolean allowed(Context c) {
        if (!enabled(c)) return false;
        return c.getSystemService(AudioManager.class).getRingerMode() == AudioManager.RINGER_MODE_NORMAL;
    }

    static void say(Context ctx) {
        if (playing != null) { Log.i(Wake.TAG, "voice skipped: already speaking"); return; }
        final Context c = ctx.getApplicationContext();
        final AudioManager am = c.getSystemService(AudioManager.class);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        // 음악이 나오고 있으면 잠깐 작게 줄였다가 돌려 놓습니다
        final AudioFocusRequest focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build();
        MediaPlayer mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(attrs);
            mp.setDataSource(c, Uri.parse("android.resource://" + c.getPackageName() + "/" + R.raw.iljeong));
            mp.setOnCompletionListener(p -> done(am, focus));
            mp.setOnErrorListener((p, what, extra) -> { Log.w(Wake.TAG, "voice error " + what); done(am, focus); return true; });
            mp.prepare();
            am.requestAudioFocus(focus);
            playing = mp;
            mp.start();
            Log.i(Wake.TAG, "voice playing");
        } catch (Exception e) {
            Log.w(Wake.TAG, "voice failed", e);
            mp.release();
            if (playing == mp) playing = null;
            am.abandonAudioFocusRequest(focus);
        }
    }

    private static void done(AudioManager am, AudioFocusRequest focus) {
        if (playing != null) { playing.release(); playing = null; }
        am.abandonAudioFocusRequest(focus);
    }
}
