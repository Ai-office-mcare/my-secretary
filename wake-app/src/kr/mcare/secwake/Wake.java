package kr.mcare.secwake;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

/** 꺼진 화면을 켭니다: 먼저 잠금화면 위 알람 화면(전체 화면 알림), 그래도 꺼져 있으면 화면을 직접 켭니다. */
final class Wake {
    static final String TAG = "SecWake";
    static final String CHANNEL = "wake";
    static final int NOTI_ID = 1;

    private Wake() {}

    static boolean screenOn(Context c) { return c.getSystemService(PowerManager.class).isInteractive(); }

    static void fire(final Context c, String title, String text, Notification source) {
        if (screenOn(c)) { Log.i(TAG, "screen already on"); return; }
        Log.i(TAG, "waking screen");
        final PowerManager pm = c.getSystemService(PowerManager.class);
        // 화면을 켜는 동안 휴대폰이 다시 잠들지 않게 잠깐만 깨워 둡니다
        pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "secwake:cpu").acquire(5000);
        try { showAlarm(c, title, text, source); } catch (RuntimeException e) { Log.w(TAG, "alarm screen failed", e); }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pm.isInteractive()) return;
            Log.i(TAG, "fallback wake lock");
            screenLock(pm);
        }, 1200);
    }

    @SuppressWarnings("deprecation")
    private static void screenLock(PowerManager pm) {
        pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "secwake:screen").acquire(10000);
    }

    private static void showAlarm(Context c, String title, String text, Notification source) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "화면 켜기 (소리 없음)", NotificationManager.IMPORTANCE_HIGH);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);

        Intent i = new Intent(c, AlarmActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra("title", title).putExtra("text", text);
        if (source != null) {
            i.putExtra("open", source.contentIntent);
            if (source.actions != null) {
                String[] names = new String[source.actions.length];
                PendingIntent[] acts = new PendingIntent[source.actions.length];
                for (int k = 0; k < names.length; k++) { names[k] = String.valueOf(source.actions[k].title); acts[k] = source.actions[k].actionIntent; }
                i.putExtra("names", names).putExtra("acts", acts);
            }
        }
        PendingIntent pi = PendingIntent.getActivity(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        nm.notify(NOTI_ID, new Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_small).setContentTitle(title).setContentText(text)
            .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(pi).setFullScreenIntent(pi, true).setAutoCancel(true).setTimeoutAfter(30000).build());
    }

    static void clear(Context c) { c.getSystemService(NotificationManager.class).cancel(NOTI_ID); }
}
