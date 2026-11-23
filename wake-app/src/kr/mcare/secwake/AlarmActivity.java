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
import java.util.HashSet;
import java.util.Set;

/** 잠금화면 위에 뜨는 알람 화면. 30초 뒤 저절로 닫히고, 원래 알림은 그대로 남습니다. */
public class AlarmActivity extends Activity {
    static AlarmActivity shown;
    private final Set<String> others = new HashSet<>();
    private LinearLayout box;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable end = this::finishAndRemoveTask;
    private final BroadcastReceiver close = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { finishAndRemoveTask(); }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        shown = this;
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // 원래 알림을 처리했거나, 전원 버튼으로 화면을 끄면 닫습니다 (다음 알람에 옛 제목이 남지 않게)
        IntentFilter f = new IntentFilter(WakeListener.CLOSE);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(close, f, RECEIVER_NOT_EXPORTED);
        else registerReceiver(close, f);
        draw(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); draw(i); }

    @Override protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        unregisterReceiver(close);
        if (shown == this) { shown = null; Wake.clear(this); }
        super.onDestroy();
    }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }

    private void draw(Intent i) {
        h.removeCallbacks(end);
        h.postDelayed(end, 30000);
        others.clear();
        box = new LinearLayout(this);
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

    void also(String key, String title) {
        if (box == null || !others.add(key)) return;
        h.removeCallbacks(end);
        h.postDelayed(end, 30000);
        box.addView(text("＋ " + title, 24, 0xFF1F1A14), 2 + others.size());
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
