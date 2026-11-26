package kr.mcare.secwake;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** 켜는 순서를 하나씩 보여 주는 화면. */
public class MainActivity extends Activity {
    private LinearLayout box;

    @Override protected void onResume() { super.onResume(); draw(); }
    @Override public void onRequestPermissionsResult(int r, String[] p, int[] g) { draw(); }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }

    private boolean listening() {
        ComponentName me = new ComponentName(this, WakeListener.class);
        if (Build.VERSION.SDK_INT >= 27) return getSystemService(NotificationManager.class).isNotificationListenerAccessGranted(me);
        String s = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(me.flattenToString());
    }
    private boolean canNotify() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean canFullScreen() {
        return Build.VERSION.SDK_INT < 34 || getSystemService(NotificationManager.class).canUseFullScreenIntent();
    }

    private void draw() {
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(56), dp(20), dp(40));
        text("내 비서 화면켜기  (1.2판)", 26, 0xFFB45309);
        text("내 비서 알림이 오면 \"일정왔어 일정왔어\" 라고 말하고, 화면이 꺼져 있으면 화면을 켭니다. 인터넷을 쓰지 않고, 내 비서가 아닌 알림에는 반응하지 않습니다.", 16, 0xFF4A4038);
        step("1. 알림 접근 허용", listening(), "목록에서 '내 비서 화면켜기' 를 켜 주세요.", v -> open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        if (!listening()) {
            text("스위치가 회색이거나 '제한된 설정' 이라고 나오면 아래 단추 → 오른쪽 위 ⋮ → '제한된 설정 허용' 을 누른 뒤 다시 해 주세요.", 14, 0xFF7A6F63);
            button("앱 정보 열기", false, v -> appInfo());
        }
        step("2. 알림 표시 허용", canNotify(), "알람 화면을 띄우는 데 씁니다.", v -> { if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1); });
        step("3. 전체 화면 알림 허용", canFullScreen(), "잠금화면 위에 알람 화면을 띄웁니다.", v -> { if (Build.VERSION.SDK_INT >= 34) open(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName()))); });
        boolean free = getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName());
        step("4. 배터리 '제한 없음'", free, "앱 정보 → 배터리 → 제한 없음", v -> appInfo());
        // 5. 내 비서(웹)가 이 휴대폰에서는 알림을 조용히 띄우고 이 앱이 목소리를 내게 바꿉니다 (#helper-voice=on)
        step("5. 첫 울림부터 목소리로", Voice.prefs(this).getBoolean("linked", false),
            "누르면 내 비서가 열리면서 이 휴대폰은 기본 '띵' 알림음 대신 \"일정 왔어\" 목소리와 진동으로 바뀝니다. 내 비서 화면에 안내가 뜨면 이 앱으로 돌아오세요.",
            v -> { Voice.prefs(this).edit().putBoolean("linked", true).apply(); open(new Intent(Intent.ACTION_VIEW, Uri.parse("https://ai-office-mcare.github.io/my-secretary/#helper-voice=on"))); });
        boolean voice = Voice.enabled(this);
        text((voice ? "🔊 목소리 알림 켜짐" : "🔇 목소리 알림 꺼짐"), 19, voice ? 0xFF15803D : 0xFF1F1A14);
        text("알림 소리 크기를 따르고, 진동 모드에서는 진동만, 무음 모드에서는 아무것도 내지 않습니다. 5번이 안 되어 있으면 기본 '띵' 소리 뒤에 목소리가 나옵니다.", 14, 0xFF7A6F63);
        button("목소리 들어보기", false, v -> { Voice.vibrate(this); Voice.say(this); });
        button(voice ? "목소리 알림 끄기" : "목소리 알림 켜기", false, v -> { Voice.setEnabled(this, !voice); draw(); });
        button("시험: 누르고 바로 화면을 끄세요 (10초 뒤 켜짐)", true, v -> test());
        text("최근: " + getSharedPreferences("log", MODE_PRIVATE).getString("last", "아직 내 비서 알림을 받지 않았습니다"), 14, 0xFF7A6F63);
        ScrollView s = new ScrollView(this);
        s.setBackgroundColor(0xFFFFFAF3);
        s.addView(box);
        setContentView(s);
    }

    private void test() {
        getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "secwake:test").acquire(14000);
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            Voice.vibrate(this);
            if (Voice.allowed(this)) Voice.say(this);
            Wake.fire(getApplicationContext(), "시험 알람", "화면이 저절로 켜졌으면 성공입니다.", null);
        }, 10000);
        Toast.makeText(this, "지금 전원 버튼을 눌러 화면을 끄세요", Toast.LENGTH_LONG).show();
    }

    private void appInfo() { open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); }
    private void open(Intent i) { try { startActivity(i); } catch (RuntimeException e) { Toast.makeText(this, "설정 화면을 열지 못했습니다", Toast.LENGTH_LONG).show(); } }

    private void step(String name, boolean ok, String how, View.OnClickListener go) {
        text((ok ? "✅ " : "⬜ ") + name, 19, ok ? 0xFF15803D : 0xFF1F1A14);
        if (!ok) { text(how, 15, 0xFF4A4038); button("여기를 눌러 허용", true, go); }
    }
    private void text(String t, int size, int color) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setPadding(0, dp(8), 0, dp(6));
        box.addView(v);
    }
    private void button(String t, boolean main, View.OnClickListener go) {
        Button v = new Button(this);
        v.setText(t);
        v.setAllCaps(false);
        v.setTextSize(16);
        v.setTextColor(main ? 0xFFFFFFFF : 0xFF1F1A14);
        v.setBackgroundColor(main ? 0xFFB45309 : 0xFFEADFCE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54));
        lp.bottomMargin = dp(10);
        v.setLayoutParams(lp);
        v.setOnClickListener(go);
        box.addView(v);
    }
}
