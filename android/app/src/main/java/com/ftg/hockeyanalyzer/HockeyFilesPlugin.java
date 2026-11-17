package com.ftg.hockeyanalyzer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Файлы на телефоне через системный выбор документов (SAF): видео матча и файл проекта.
 * Разрешения на выбранные файлы сохраняются, поэтому проект открывается и после перезапуска.
 */
@CapacitorPlugin(name = "HockeyFiles")
public class HockeyFilesPlugin extends Plugin {

    /** Проект больше этого — не наш файл. */
    private static final int MAX_PROJECT_BYTES = 20 * 1024 * 1024;

    @PluginMethod
    public void pickVideo(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onVideoPicked");
    }

    @ActivityCallback
    private void onVideoPicked(PluginCall call, ActivityResult result) {
        Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Нет доступа к видео: выберите файл через «Файлы»");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", displayName(uri));
        call.resolve(ret);
    }

    /** Длительность, размер кадра (с учётом поворота), fps и кодек видео. */
    @PluginMethod
    public void probe(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null) {
            call.reject("Нет uri");
            return;
        }
        Uri uri = Uri.parse(raw);
        // свои скачанные из VK читаем всегда; чужие — только которые пользователь сам выбрал
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()) || (!isOwnFile(uri) && !hasPersisted(uri, false))) {
            call.reject("Видео не выбрано на этом телефоне");
            return;
        }
        // MediaExtractor читает файл — не в главном потоке
        new Thread(() -> {
            try {
                call.resolve(describe(uri));
            } catch (Exception e) {
                call.reject("Видео недоступно: " + e.getMessage());
            }
        })
            .start();
    }

    private JSObject describe(Uri uri) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            extractor.setDataSource(getContext(), uri, null);
            int track = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    track = i;
                    format = f;
                    break;
                }
            }
            if (format == null) throw new IOException("в файле нет видеодорожки");

            retriever.setDataSource(getContext(), uri);
            double duration = number(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)) / 1000.0;
            if (duration <= 0 && format.containsKey(MediaFormat.KEY_DURATION)) duration = format.getLong(MediaFormat.KEY_DURATION) / 1e6;
            int width = format.getInteger(MediaFormat.KEY_WIDTH);
            int height = format.getInteger(MediaFormat.KEY_HEIGHT);
            int rotation = (int) number(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
            // видео с телефона, снятое вертикально, хранится «лёжа» с пометкой поворота — плеер показывает его повёрнутым
            if (rotation == 90 || rotation == 270) {
                int t = width;
                width = height;
                height = t;
            }

            double fps = frameRate(format);
            if (fps <= 0) fps = sampledFrameRate(extractor, track);

            JSObject ret = new JSObject();
            ret.put("duration", duration);
            ret.put("width", width);
            ret.put("height", height);
            ret.put("fps", fps > 0 ? fps : 30);
            ret.put("codec", format.getString(MediaFormat.KEY_MIME));
            ret.put("name", displayName(uri));
            return ret;
        } finally {
            extractor.release();
            try {
                retriever.release();
            } catch (IOException ignored) {}
        }
    }

    private static double frameRate(MediaFormat format) {
        if (!format.containsKey(MediaFormat.KEY_FRAME_RATE)) return 0;
        // в одних файлах число целое, в других дробное
        try {
            return format.getInteger(MediaFormat.KEY_FRAME_RATE);
        } catch (ClassCastException e) {
            try {
                return format.getFloat(MediaFormat.KEY_FRAME_RATE);
            } catch (ClassCastException e2) {
                return 0;
            }
        }
    }

    /** fps по меткам времени первых кадров, если в заголовке его нет. */
    private static double sampledFrameRate(MediaExtractor extractor, int track) {
        extractor.selectTrack(track);
        long first = -1;
        long last = -1;
        int frames = 0;
        while (frames < 120) {
            long t = extractor.getSampleTime();
            if (t < 0) break;
            if (first < 0) first = t;
            last = t;
            frames++;
            if (!extractor.advance()) break;
        }
        if (frames < 2 || last <= first) return 0;
        return (frames - 1) / ((last - first) / 1e6);
    }

    private static double number(String s) {
        if (s == null) return 0;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @PluginMethod
    public void pickProject(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // мессенджеры и почта сохраняют json как text/plain или octet-stream
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onProjectPicked");
    }

    @ActivityCallback
    private void onProjectPicked(PluginCall call, ActivityResult result) {
        Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        boolean writable = persist(uri, result.getData().getFlags());
        // файл с Google Диска может читаться долго — не в главном потоке
        new Thread(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("name", displayName(uri));
                ret.put("text", readText(uri));
                ret.put("writable", writable);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Не удалось прочитать файл: " + e.getMessage());
            }
        })
            .start();
    }

    /** Новый файл в выбранной пользователем папке (Загрузки, Google Диск…) с текстом проекта. */
    @PluginMethod
    public void createDocument(PluginCall call) {
        String name = call.getString("name", "проект.hockey.json");
        if (call.getString("text") == null) {
            call.reject("Нет текста");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, name);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onDocumentCreated");
    }

    @ActivityCallback
    private void onDocumentCreated(PluginCall call, ActivityResult result) {
        Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(new JSObject());
            return;
        }
        persist(uri, result.getData().getFlags());
        // запись в облачную папку может идти долго — не в главном потоке
        new Thread(() -> {
            try {
                writeText(uri, call.getString("text"));
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                ret.put("name", displayName(uri));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Не удалось сохранить: " + e.getMessage());
            }
        })
            .start();
    }

    /** Перезаписать уже выбранный файл проекта. */
    @PluginMethod
    public void writeDocument(PluginCall call) {
        String raw = call.getString("uri");
        String text = call.getString("text");
        if (raw == null || text == null) {
            call.reject("Нет uri или текста");
            return;
        }
        Uri uri = Uri.parse(raw);
        // перезаписываем только файлы, которые пользователь сам выбрал или создал с правом записи
        if (!hasPersisted(uri, true)) {
            call.reject("Нет права записи в этот файл — сохраните как новый");
            return;
        }
        new Thread(() -> {
            // любое исключение — отказ, иначе JS ждёт ответа вечно и «Сохранить как новый» не сработает
            try {
                writeText(uri, text);
                call.resolve();
            } catch (Exception e) {
                call.reject("Не удалось сохранить: " + e.getMessage());
            }
        })
            .start();
    }

    private static Uri resultUri(ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) return null;
        return result.getData().getData();
    }

    /** Сохранить разрешение на файл после перезапуска; true — можно и записывать. */
    private boolean persist(Uri uri, int flags) {
        ContentResolver resolver = getContext().getContentResolver();
        boolean canWrite = (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0;
        try {
            int mode = Intent.FLAG_GRANT_READ_URI_PERMISSION | (canWrite ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
            resolver.takePersistableUriPermission(uri, mode);
            return canWrite;
        } catch (SecurityException e) {
            // некоторые приложения дают разрешение только на этот запуск
            return false;
        }
    }

    /** Есть ли сохранённое разрешение на этот файл (выбран или создан пользователем). */
    private boolean hasPersisted(Uri uri, boolean write) {
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && (write ? p.isWritePermission() : p.isReadPermission())) return true;
        }
        return false;
    }

    /** Наш FileProvider: файлы, скачанные из VK, — свои, разрешение на них у приложения есть всегда. */
    private boolean isOwnFile(Uri uri) {
        return (getContext().getPackageName() + ".fileprovider").equals(uri.getAuthority());
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        String last = uri.getLastPathSegment();
        return last != null ? last : "video";
    }

    private String readText(Uri uri) throws IOException {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("файл не открылся");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_PROJECT_BYTES) throw new IOException("файл слишком большой для проекта");
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void writeText(Uri uri, String text) throws IOException {
        // "wt" — с обрезкой: короче старого файла проект не должен оставить хвост
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException("файл не открылся на запись");
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
