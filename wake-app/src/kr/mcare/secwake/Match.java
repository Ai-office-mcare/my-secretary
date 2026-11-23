package kr.mcare.secwake;

/** 내 비서 알림인지 가리는 규칙 (순수 계산). */
final class Match {
    static final String HOST = "ai-office-mcare.github.io";
    static final String NAME = "내비서";

    private Match() {}

    /**
     * 크롬·설치된 웹앱이 띄운 알림의 tag 에는 주소와 앱이 붙인 tag(sec-...)가 들어 있습니다.
     * 설치된 웹앱이면 앱 이름(내 비서)으로도 알아봅니다.
     */
    static boolean isSecretary(String pkg, String tag, String channel, String appLabel) {
        String t = tag == null ? "" : tag, c = channel == null ? "" : channel;
        if ((t.contains(HOST) || c.contains(HOST)) && t.contains("sec-")) return true;
        return pkg != null && pkg.startsWith("org.chromium.webapk.") && appLabel != null && appLabel.replace(" ", "").equals(NAME);
    }
}
