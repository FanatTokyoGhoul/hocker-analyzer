package com.ftg.hockeyanalyzer;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebChromeClient;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HockeyFilesPlugin.class);
        registerPlugin(HockeyVkPlugin.class);
        super.onCreate(savedInstanceState);
        // приложение без статуса: сразу весь экран, как у видеоплееров; свайп от верха показывает полоску транзитом
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        noStatusBar();
        bridge.setWebViewClient(new VideoWebViewClient(bridge));
        bridge
            .getWebView()
            .setWebChromeClient(
                new BridgeWebChromeClient(bridge) {
                    // без постера WebView рисует серую заглушку с «плей» поверх ещё не показанного кадра
                    @Override
                    public Bitmap getDefaultVideoPoster() {
                        return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                    }

                    // Fullscreen API: Capacitor отказывает (onCustomViewHidden), а нам нужен настоящий полный экран —
                    // контент разворачиваем поверх активности, системные панели скрываем
                    @Override
                    public void onShowCustomView(View view, CustomViewCallback callback) {
                        if (customView != null) {
                            callback.onCustomViewHidden();
                            return;
                        }
                        customView = view;
                        customCallback = callback;
                        ViewGroup root = findViewById(android.R.id.content);
                        root.addView(view, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                        systemBars(false);
                    }

                    @Override
                    public void onHideCustomView() {
                        if (customView != null) {
                            ((ViewGroup) findViewById(android.R.id.content)).removeView(customView);
                            customView = null;
                        }
                        systemBars(true);
                        if (customCallback != null) {
                            customCallback.onCustomViewHidden();
                            customCallback = null;
                        }
                    }
                }
            );
    }

    /** Убрать/вернуть панели при входе/выходе из полного экрана; статус-бар возвращаем скрытым — он убран на весь сеанс. */
    private void systemBars(boolean show) {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (show) {
            controller.show(WindowInsetsCompat.Type.navigationBars());
            controller.hide(WindowInsetsCompat.Type.statusBars());
        } else {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    /** Строка статуса скрыта; поведению «показать свайпом» не противоречит — он глобальный. */
    private void noStatusBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // после возвращения из-под других приложений система любит вернуть статус-бар
        if (hasFocus && customView == null) noStatusBar();
    }
}
