package kr.mcare.secwake;

import android.app.Notification;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Log;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** 내 비서 알림에만 반응합니다. 다른 알림의 제목·내용은 읽지도 저장하지도 않습니다. */
public class WakeListener extends NotificationListenerService {
    static final String CLOSE = "kr.mcare.secwake.CLOSE";
    private String shownKey;

    @Override public void onNotificationPosted(StatusBarNotification n) {
        if (n == null || getPackageName().equals(n.getPackageName())) return;
        Notification x = n.getNotification();
        if ((x.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        if (!Match.isSecretary(n.getPackageName(), n.getTag(), x.getChannelId(), label(n.getPackageName()))) return;
        speak(n);
        boolean off = !Wake.screenOn(this);
        // 진단용: 시각과 화면 상태만 적습니다 (알림 내용은 저장하지 않음)
        String at = new SimpleDateFormat("M/d HH:mm:ss", Locale.KOREA).format(new Date());
        getSharedPreferences("log", MODE_PRIVATE).edit().putString("last", at + (off ? " · 꺼진 화면을 켬" : " · 화면이 이미 켜져 있었음")).apply();
        Bundle e = x.extras;
        CharSequence big = e.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence text = big != null ? big : e.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence title = e.getCharSequence(Notification.EXTRA_TITLE);
        String t = title == null ? "내 비서 알람" : title.toString();
        if (!off) {
          // 알람 화면이 떠 있을 때 다른 일정의 알람이 겹쳐 오면 제목을 덧붙입니다 (같은 알람의 2·3번째 울림은 빼고)
          if (AlarmActivity.shown != null && shownKey != null && !shownKey.equals(n.getKey())) AlarmActivity.shown.also(n.getKey(), t);
          return;
        }
        shownKey = n.getKey();
        Wake.fire(this, t, text == null ? "" : text.toString(), x);
    }

    // "일정 왔어" 목소리 (2026-11-26). 앱이 화면에 떠 있을 때의 조용한 알림(-quiet)은 앱이 직접 말하므로 빼고,
    // 방해 금지 모드에 걸린 알림도 뺍니다. 3번 울림이면 알림이 3번 다시 떠서 목소리도 3번.
    private void speak(StatusBarNotification n) {
        String tag = n.getTag();
        if (tag != null && tag.endsWith("-quiet")) { Log.i(Wake.TAG, "voice skipped: quiet"); return; }
        Ranking r = new Ranking();
        RankingMap m = getCurrentRanking();
        if (m != null && m.getRanking(n.getKey(), r) && !r.matchesInterruptionFilter()) { Log.i(Wake.TAG, "voice skipped: do not disturb"); return; }
        if (!Voice.allowed(this)) { Log.i(Wake.TAG, "voice skipped: off or silent mode"); return; }
        Voice.say(this);
    }

    // 원래 알림을 처리하거나 지우면 알람 화면도 닫습니다
    @Override public void onNotificationRemoved(StatusBarNotification n) {
        if (n == null || shownKey == null || !shownKey.equals(n.getKey())) return;
        shownKey = null;
        Wake.clear(this);
        sendBroadcast(new Intent(CLOSE).setPackage(getPackageName()));
    }

    private String label(String pkg) {
        if (pkg == null || !pkg.startsWith("org.chromium.webapk.")) return null;
        try {
            PackageManager pm = getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (PackageManager.NameNotFoundException e) { return null; }
    }
}
