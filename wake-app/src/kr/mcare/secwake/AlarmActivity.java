package kr.mcare.secwake;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** 잠금화면 위에 뜨는 알람 화면. 30초 뒤 저절로 닫히고, 원래 알림은 그대로 남습니다. */
public class AlarmActivity extends Activity {
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable end = this::finishAndRemoveTask;
    private final BroadcastReceiver close = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { finishAndRemoveTask(); }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(close, new IntentFilter(WakeListener.CLOSE), RECEIVER_NOT_EXPORTED);
        else registerReceiver(close, new IntentFilter(WakeListener.CLOSE));
        draw(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); draw(i); }

    @Override protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        unregisterReceiver(close);
        Wake.clear(this);
        super.onDestroy();
    }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }

    private void draw(Intent i) {
        h.removeCallbacks(end);
        h.postDelayed(end, 30000);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(24), dp(48), dp(24), dp(32));
        box.setBackgroundColor(0xFFFFFAF3);
        box.addView(text("⏰ 내 비서", 18, 0xFFB45309));
        box.addView(text(i.getStringExtra("title"), 32, 0xFF1F1A14));
        box.addView(text(i.getStringExtra("text"), 19, 0xFF4A4038));
        String[] names = i.getStringArrayExtra("names");
        Parcelable[] acts = i.getParcelableArrayExtra("acts");
        Parcelable open = i.getParcelableExtra("open");
        if (names != null && acts != null && names.length > 0) {
            for (int k = 0; k < names.length; k++) if (acts[k] instanceof PendingIntent) box.addView(button(names[k], k == 0, (PendingIntent) acts[k]));
        } else if (open instanceof PendingIntent) {
            box.addView(button("내 비서 열기", true, (PendingIntent) open));
        }
        box.addView(button("닫기 (다시 알림은 계속)", false, null));
        ScrollView s = new ScrollView(this);
        s.setFillViewport(true);
        s.setBackgroundColor(0xFFFFFAF3);
        s.addView(box);
        setContentView(s);
    }

    private TextView text(String t, int size, int color) {
        TextView v = new TextView(this);
        v.setText(t == null ? "" : t);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setGravity(Gravity.CENTER);
        v.setPadding(0, 0, 0, dp(16));
        return v;
    }

    private View button(String t, boolean main, PendingIntent p) {
        Button v = new Button(this);
        v.setText(t);
        v.setAllCaps(false);
        v.setTextSize(19);
        v.setTextColor(main ? Color.WHITE : 0xFF1F1A14);
        v.setBackgroundColor(main ? 0xFFB45309 : 0xFFEADFCE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60));
        lp.topMargin = dp(10);
        v.setLayoutParams(lp);
        v.setOnClickListener(x -> { if (p == null) finishAndRemoveTask(); else unlockAndSend(p); });
        return v;
    }

    // 완료·열기는 앱을 여는 동작이라 잠금을 먼저 풉니다
    private void unlockAndSend(PendingIntent p) {
        KeyguardManager km = getSystemService(KeyguardManager.class);
        if (!km.isKeyguardLocked()) { send(p); return; }
        h.removeCallbacks(end);
        h.postDelayed(end, 60000);
        km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
            @Override public void onDismissSucceeded() { send(p); }
        });
    }

    private void send(PendingIntent p) {
        try { p.send(); } catch (PendingIntent.CanceledException e) { /* 이미 처리된 알림 */ }
        finishAndRemoveTask();
    }
}
