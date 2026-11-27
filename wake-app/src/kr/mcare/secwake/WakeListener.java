package kr.mcare.secwake;

import android.app.Notification;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
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
        boolean off = !Wake.screenOn(this);
        String said = ring(n);
        // 진단용: 시각과 화면 상태, 무엇을 울렸는지만 적습니다 (알림 내용은 저장하지 않음)
        String at = new SimpleDateFormat("M/d HH:mm:ss", Locale.KOREA).format(new Date());
        getSharedPreferences("log", MODE_PRIVATE).edit().putString("last", at + (off ? " · 꺼진 화면을 켬" : " · 화면이 이미 켜져 있었음") + " · " + said).apply();
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

    // 소리는 휴대폰 기본 알림음이 내고, 이 앱은 진동을 함께 냅니다 (2026-11-27 대표님 요청: 목소리 없애고 알림음으로, 소리 모드에서도 진동).
    // 앱이 화면에 떠 있을 때의 조용한 알림(-quiet)은 앱이 직접 울리므로 빼고, 방해 금지 모드에 걸린 알림도 뺍니다.
    // 예전 판 내 비서는 "목소리로" 휴대폰에서 알림을 소리 없이(-voice) 띄웠으므로 그때는 기본 알림음도 여기서 냅니다.
    private String ring(StatusBarNotification n) {
        String tag = n.getTag();
        if (tag != null && tag.endsWith("-quiet")) { Log.i(Wake.TAG, "ring skipped: quiet"); return "앱이 열려 있어 앱이 울림"; }
        boolean silentPost = tag != null && tag.endsWith("-voice");
        Ranking r = new Ranking();
        RankingMap m = getCurrentRanking();
        if (m != null && m.getRanking(n.getKey(), r) && !r.matchesInterruptionFilter()) { Log.i(Wake.TAG, "ring skipped: do not disturb"); return "방해 금지라 진동 안 함"; }
        int ringer = Ring.ringer(this);
        if (ringer == AudioManager.RINGER_MODE_NORMAL) { Ring.vibrate(this); if (silentPost) Ring.ding(this); return "알림음 + 진동"; }
        if (ringer == AudioManager.RINGER_MODE_VIBRATE) { if (silentPost) Ring.vibrate(this); return "진동 모드"; }
        return "무음 모드";
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
