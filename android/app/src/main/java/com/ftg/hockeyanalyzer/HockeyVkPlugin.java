package com.ftg.hockeyanalyzer;

import android.content.Context;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Скачивание видео VK на телефоне: yt-dlp здесь запустить нечем, поэтому приложение делает
 * то же, что браузер: читает embed-страницу и ответ al_video.php (тексты забирает JS-парсер,
 * src/mobile/vkParse.ts), а файл качает само — с прогрессом, отменой и склейкой HLS-сегментов.
 * Видео кладёт в свою папку «VK» и отдаёт через FileProvider — дальше файл работает как выбранный.
 */
@CapacitorPlugin(name = "HockeyVk")
public class HockeyVkPlugin extends Plugin {

    /** Десктопный Chrome: по мобильному UA VK отдаёт страницу без параметров плеера. */
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    /** Ответы страниц VK — сотни килобайт; больше — что-то не так. */
    private static final int MAX_TEXT_BYTES = 8 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    /** Куки первой страницы нужны al_video.php; живут до следующей ссылки — как в браузере без входа. */
    private final Map<String, String> cookies = new HashMap<>();
    private volatile boolean cancelled;
    private volatile HttpURLConnection active;
    /** Кодировка последнего ответа http() — VK отвечает в windows-1251. */
    private volatile Charset lastCharset = StandardCharsets.UTF_8;

    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://vk.com/")) {
            call.reject("Разрешены только адреса vk.com");
            return;
        }
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        String referer = call.getString("referer");
        new Thread(() -> {
            try {
                byte[] data = http(url, method, body, referer);
                // al_video.php приходит с charset=windows-1251 — по UTF-8 кириллица в названии превращается в «?»
                call.resolve(new JSObject().put("text", new String(data, lastCharset)));
            } catch (IOException e) {
                call.reject("VK не ответил: " + e.getMessage());
            }
        })
            .start();
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "Видео VK.mp4");
        String referer = call.getString("referer");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Нет адреса видео");
            return;
        }
        cancelled = false;
        new Thread(() -> {
            try {
                File file = downloadTo(url, name, referer);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                call.resolve(new JSObject().put("uri", uri.toString()).put("name", file.getName()));
            } catch (Exception e) {
                call.reject(cancelled ? "Скачивание отменено" : "Не удалось скачать видео: " + e.getMessage());
            } finally {
                active = null;
            }
        })
            .start();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection c = active;
        if (c != null) c.disconnect();
        call.resolve();
    }

    // ---------- http ----------

    private byte[] http(String url, String method, String body, String referer) throws IOException {
        HttpURLConnection conn = open(url, method, referer);
        conn.setInstanceFollowRedirects(true);
        if (body != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        try {
            rememberCookies(conn);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) throw new IOException("VK просит войти в аккаунт — это видео недоступно без входа");
            if (code < 200 || code >= 400) throw new IOException("ответ " + code);
            lastCharset = charsetOf(conn.getContentType());
            return readCapped(conn.getInputStream(), MAX_TEXT_BYTES);
        } finally {
            conn.disconnect();
        }
    }

    /** Кодировка из Content-Type ответа; VK для al_video.php указывает windows-1251. */
    private static Charset charsetOf(String contentType) {
        if (contentType != null) {
            int i = contentType.toLowerCase().indexOf("charset=");
            if (i >= 0) {
                String name = contentType.substring(i + 8).trim().replaceAll("[\"';].*$", "");
                try {
                    return Charset.forName(name);
                } catch (Exception ignored) {
                    // неизвестная кодировка — ниже UTF-8
                }
            }
        }
        return StandardCharsets.UTF_8;
    }

    private HttpURLConnection open(String url, String method, String referer) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method == null ? "GET" : method);
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("Accept", "*/*");
        // al_video.php без этих заголовков отвечает «неизвестная ошибка»
        if ("POST".equalsIgnoreCase(method)) conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        if (referer != null) conn.setRequestProperty("Referer", referer);
        synchronized (cookies) {
            if (!cookies.isEmpty() && url.startsWith("https://vk.com/")) conn.setRequestProperty("Cookie", cookieHeader());
        }
        active = conn;
        return conn;
    }

    private String cookieHeader() {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : cookies.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    private void rememberCookies(HttpURLConnection conn) {
        List<String> headers = conn.getHeaderFields().get("Set-Cookie");
        if (headers == null) return;
        synchronized (cookies) {
            for (String h : headers) {
                String pair = h.split(";", 2)[0];
                int eq = pair.indexOf('=');
                if (eq > 0) cookies.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
            }
        }
    }

    private static byte[] readCapped(InputStream in, int cap) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            int total = 0;
            while ((n = stream.read(buf)) > 0) {
                out.write(buf, 0, n);
                total += n;
                if (total > cap) throw new IOException("ответ слишком большой");
            }
            return out.toByteArray();
        }
    }

    // ---------- скачивание файла ----------

    private File downloadTo(String url, String name, String referer) throws IOException {
        File dir = new File(getContext().getExternalFilesDir(null), "VK");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("не создать папку для видео");
        File target = unique(new File(dir, safeName(name)));

        HttpURLConnection conn = open(url, "GET", referer == null ? "https://vk.com/" : referer);
        long done = 0;
        long total;
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 400) throw new IOException("ответ " + code);
            String type = conn.getContentType();
            total = conn.getContentLengthLong();
            File part = new File(target.getAbsolutePath() + ".part");
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                if (type != null && (type.contains("mpegurl") || url.contains(".m3u8"))) {
                    downloadHls(readCapped(in, MAX_TEXT_BYTES), url, referer, out, total > 0 ? total : null);
                } else {
                    pipeProgress(in, out, total, -1);
                }
            } catch (Exception e) {
                part.delete();
                throw e;
            }
            if (!part.renameTo(target)) throw new IOException("не удалось переименовать файл");
            done = target.length();
            report(1.0, done, total > 0 ? total : done, 0, 0);
            return target;
        } finally {
            conn.disconnect();
        }
    }

    /** Прогресс по байтам; estimatedTotal <= 0 — размер неизвестен. */
    private void pipeProgress(InputStream in, OutputStream out, long total, int unused) throws IOException {
        byte[] buf = new byte[64 * 1024];
        long done = 0;
        long startedAt = System.currentTimeMillis();
        long lastNotify = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            if (cancelled) throw new IOException("отменено");
            out.write(buf, 0, n);
            done += n;
            long now = System.currentTimeMillis();
            if (now - lastNotify > 300) {
                lastNotify = now;
                long ms = Math.max(1, now - startedAt);
                long speed = done * 1000 / ms;
                long eta = total > 0 && speed > 0 ? (total - done) / speed : 0;
                report(total > 0 ? (double) done / total : null, done, total, speed, eta);
            }
        }
    }

    // ---------- HLS: fMP4-сегменты склеиваются в один mp4 ----------

    private void downloadHls(byte[] playlistBytes, String playlistUrl, String referer, OutputStream out, Long declaredTotal) throws IOException {
        String playlist = new String(playlistBytes, StandardCharsets.UTF_8);
        // мастер-плейлист: берём вариант с наибольшим bandwidth
        if (playlist.contains("#EXT-X-STREAM-INF")) {
            String best = null;
            long bestBw = -1;
            Matcher m = Pattern.compile("#EXT-X-STREAM-INF:[^\\n]*BANDWIDTH=(\\d+)[^\\n]*\\n([^\\n#]+)").matcher(playlist);
            while (m.find()) {
                long bw = Long.parseLong(m.group(1));
                if (bw > bestBw) {
                    bestBw = bw;
                    best = m.group(2).trim();
                }
            }
            if (best == null) throw new IOException("в HLS-плейлисте нет вариантов");
            byte[] next = http(resolve(playlistUrl, best), "GET", null, referer);
            playlist = new String(next, StandardCharsets.UTF_8);
            playlistUrl = resolve(playlistUrl, best);
        }
        Matcher map = Pattern.compile("#EXT-X-MAP:URI=\"([^\"]+)\"").matcher(playlist);
        String init = map.find() ? resolve(playlistUrl, map.group(1)) : null;
        List<String> segments = new ArrayList<>();
        boolean ts = false;
        String[] lines = playlist.split("\\R");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.startsWith("#") || line.isEmpty()) continue;
            String seg = resolve(playlistUrl, line);
            String path = seg.split("[?#]", 2)[0].toLowerCase();
            if (path.endsWith(".ts") || path.endsWith(".m2ts")) ts = true;
            segments.add(seg);
        }
        if (segments.isEmpty()) throw new IOException("в плейлисте нет сегментов");
        if (ts) throw new IOException("это видео отдаётся MPEG-TS, на телефоне его не собрать — откройте на компьютере");
        int totalSteps = segments.size() + (init != null ? 1 : 0);
        int step = 0;
        long bytes = 0;
        if (init != null) {
            out.write(http(init, "GET", null, referer));
            step++;
        }
        long startedAt = System.currentTimeMillis();
        long lastNotify = 0;
        for (String seg : segments) {
            if (cancelled) throw new IOException("отменено");
            byte[] data = http(seg, "GET", null, referer);
            out.write(data);
            bytes += data.length;
            step++;
            long now = System.currentTimeMillis();
            if (now - lastNotify > 300) {
                lastNotify = now;
                long ms = Math.max(1, now - startedAt);
                long speed = bytes * 1000 / ms;
                report((double) step / totalSteps, bytes, declaredTotal == null ? -1 : declaredTotal, speed, 0);
            }
        }
    }

    private static String resolve(String base, String ref) {
        try {
            return new URL(new URL(base), ref).toString();
        } catch (IOException e) {
            return ref;
        }
    }

    private void report(Double ratio, long downloaded, long total, long speed, long eta) {
        JSObject p = new JSObject();
        p.put("phase", "video");
        p.put("ratio", ratio == null ? JSObject.NULL : ratio);
        p.put("downloaded", downloaded);
        p.put("total", total > 0 ? total : JSObject.NULL);
        p.put("speed", speed > 0 ? speed : JSObject.NULL);
        p.put("eta", eta > 0 ? eta : JSObject.NULL);
        p.put("title", JSObject.NULL);
        notifyListeners("vkProgress", p);
    }

    /** «Видео.mp4», «Видео (2).mp4»… */
    private static File unique(File file) {
        if (!file.exists()) return file;
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        for (int i = 2; ; i++) {
            File next = new File(file.getParentFile(), name.substring(0, dot) + " (" + i + ")" + name.substring(dot));
            if (!next.exists()) return next;
        }
    }

    private static String safeName(String name) {
        String clean = name.replaceAll("[/\\\\:*?\"<>|\\u0000-\\u001f]", " ").trim();
        if (clean.length() > 120) clean = clean.substring(0, 120);
        return clean.isEmpty() || !clean.contains(".") ? "Видео VK.mp4" : clean;
    }
}
