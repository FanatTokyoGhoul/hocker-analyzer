package com.ftg.hockeyanalyzer;

import android.content.ContentResolver;
import android.content.Context;
import android.content.UriPermission;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Отдаёт видео из content:// по адресу /_hockey_video_?u=… с честными Range-ответами:
 * плеер WebView перематывает длинный матч, запрашивая куски файла.
 * Встроенный сервер Capacitor считает размер файла через available() (для content:// это не размер,
 * а у файлов больше 2 ГБ ещё и переполнение int) — перемотка ломается.
 */
public class VideoWebViewClient extends BridgeWebViewClient {

    public static final String PATH = "/_hockey_video_";

    private final Context context;

    public VideoWebViewClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        // только адрес самого приложения: чужая страница в WebView не должна читать видео
        if ("localhost".equals(url.getHost()) && PATH.equals(url.getPath())) return serve(request);
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse serve(WebResourceRequest request) {
        String raw = request.getUrl().getQueryParameter("u");
        Uri uri = raw == null ? null : Uri.parse(raw);
        // файлы, которые пользователь сам выбрал (постоянное разрешение), и свои скачанные из VK
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()) || !(isOwnFile(uri) || isPermitted(uri))) {
            return status(403, "Forbidden");
        }
        ContentResolver resolver = context.getContentResolver();
        AssetFileDescriptor afd = null;
        try {
            afd = resolver.openAssetFileDescriptor(uri, "r");
            if (afd == null) return status(404, "Not Found");
            long size = afd.getLength();
            if (size == AssetFileDescriptor.UNKNOWN_LENGTH) size = afd.getParcelFileDescriptor().getStatSize();
            if (size < 0) {
                afd.close();
                return status(500, "Unknown Size");
            }
            // отдаём только как видео: выбранный «проект» (html, svg) не должен открыться страницей приложения
            String mime = resolver.getType(uri);
            if (mime == null || !mime.startsWith("video/")) mime = "video/mp4";

            long start = 0;
            long end = size - 1;
            boolean partial = false;
            String range = header(request, "Range");
            if (range != null && range.startsWith("bytes=")) {
                long[] r = parseRange(range.substring(6), size);
                if (r == null) {
                    afd.close();
                    Map<String, String> h = new HashMap<>();
                    h.put("Content-Range", "bytes */" + size);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, empty());
                }
                start = r[0];
                end = r[1];
                partial = true;
            }

            // поток — с начала файла: до начала диапазона WebView докручивает сам (InputStream.skip по заголовку Range
            // запроса), повторный пропуск здесь увёл бы чтение за конец файла
            InputStream in = afd.createInputStream();
            long length = end - start + 1;

            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", Long.toString(length));
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "sandbox; default-src 'none'");
            if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers, new Limited(in, end + 1));
        } catch (IOException | SecurityException e) {
            if (afd != null) {
                try {
                    afd.close();
                } catch (IOException ignored) {}
            }
            return status(404, "Not Found");
        }
    }

    private boolean isPermitted(Uri uri) {
        for (UriPermission p : context.getContentResolver().getPersistedUriPermissions()) {
            if (p.isReadPermission() && p.getUri().equals(uri)) return true;
        }
        return false;
    }

    /** Видео, скачанное приложением из VK: файл лежит в нашей папке, отдаём без SAF-разрешений. */
    private boolean isOwnFile(Uri uri) {
        return (context.getPackageName() + ".fileprovider").equals(uri.getAuthority());
    }

    /** bytes=a-b, a-, -n → [начало, конец] включительно; null — диапазон за пределами файла. */
    static long[] parseRange(String spec, long size) {
        // несколько диапазонов плеер не просит — берём первый
        String first = spec.split(",")[0].trim();
        int dash = first.indexOf('-');
        if (dash < 0 || size <= 0) return null;
        try {
            String a = first.substring(0, dash).trim();
            String b = first.substring(dash + 1).trim();
            long start;
            long end;
            if (a.isEmpty()) {
                long n = Long.parseLong(b);
                if (n <= 0) return null;
                start = Math.max(0, size - n);
                end = size - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? size - 1 : Math.min(Long.parseLong(b), size - 1);
            }
            if (start < 0 || start >= size || end < start) return null;
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String header(WebResourceRequest request, String name) {
        for (Map.Entry<String, String> e : request.getRequestHeaders().entrySet()) {
            if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static InputStream empty() {
        return new ByteArrayInputStream(new byte[0]);
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), empty());
    }

    /** Поток не дальше конца запрошенного диапазона (left — сколько байт от начала файла можно прочитать). */
    private static final class Limited extends FilterInputStream {

        private long left;

        Limited(InputStream in, long left) {
            super(in);
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(Math.min(n, left));
            left -= s;
            return s;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }
}
