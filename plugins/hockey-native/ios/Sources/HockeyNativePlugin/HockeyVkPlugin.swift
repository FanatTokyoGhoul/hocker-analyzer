import Foundation
import Capacitor

/**
 * Скачивание видео VK на iPhone: yt-dlp здесь запустить нечем, поэтому повторяем путь браузера —
 * POST al_video.php act=show&al=1 с десктопным User-Agent (тексты разбирает JS, src/mobile/vkParse.ts),
 * а файл качаем сами: с прогрессом, отменой и склейкой HLS fMP4-сегментов в один mp4.
 * Аналог android/…/HockeyVkPlugin.java.
 */
@objc(HockeyVkPlugin)
public class HockeyVkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HockeyVkPlugin"
    public let pluginName = "HockeyVk"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "fetchText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    /** Десктопный Chrome: по мобильному UA VK отдаёт страницу без параметров плеера. */
    static let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    /** Ответы страниц VK — сотни килобайт; больше — что-то не так. */
    private static let maxTextBytes = 8 * 1024 * 1024

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 24 * 60 * 60
        config.httpCookieAcceptPolicy = .always
        return URLSession(configuration: config)
    }()

    private var cancelled = false
    private var activeTask: URLSessionDownloadTask?
    private let taskLock = NSLock()

    // ---------- тексты страниц ----------

    @objc func fetchText(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), raw.hasPrefix("https://vk.com/"), let url = URL(string: raw) else {
            call.reject("Разрешены только адреса vk.com")
            return
        }
        let method = call.getString("method") ?? "GET"
        let body = call.getString("body")
        let referer = call.getString("referer")
        Task { [weak self] in
            guard let self = self else { return }
            do {
                let data = try await self.http(url, method: method, body: body, referer: referer)
                // al_video.php приходит с charset=windows-1251 — по UTF-8 кириллица в названии превращается в «?»
                let text = String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .windowsCP1251)
                    ?? String(decoding: data, as: UTF8.self)
                call.resolve(["text": text])
            } catch {
                call.reject("VK не ответил: \(error.localizedDescription)")
            }
        }
    }

    // ---------- скачивание файла ----------

    @objc func download(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), raw.hasPrefix("https"), let url = URL(string: raw) else {
            call.reject("Нет адреса видео")
            return
        }
        let name = call.getString("name") ?? "Видео VK.mp4"
        let referer = call.getString("referer") ?? "https://vk.com/"
        cancelled = false
        Task { [weak self] in
            guard let self = self else { return }
            do {
                let file = try await self.downloadTo(url, name: name, referer: referer)
                call.resolve(["uri": file.absoluteString, "name": file.lastPathComponent])
            } catch {
                call.reject(self.cancelled ? "Скачивание отменено" : "Не удалось скачать видео: \(error.localizedDescription)")
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        cancelled = true
        taskLock.lock()
        let task = activeTask
        taskLock.unlock()
        task?.cancel()
        call.resolve()
    }

    private func downloadTo(_ url: URL, name: String, referer: String) async throws -> URL {
        let target = Self.uniqueFile(hockeyVkDir().appendingPathComponent(Self.safeName(name)))
        let part = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".part")
        defer { try? FileManager.default.removeItem(at: part) }

        var request = URLRequest(url: url)
        request.setValue(Self.ua, forHTTPHeaderField: "User-Agent")
        request.setValue(referer, forHTTPHeaderField: "Referer")
        let (tmp, response) = try await downloadFile(request)
        try checkCancelled(response)
        let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
        let total = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Length").flatMap { Int64($0) } ?? -1
        defer { try? FileManager.default.removeItem(at: tmp) }

        if type.contains("mpegurl") || url.absoluteString.contains(".m3u8") {
            try await downloadHls(Data(contentsOf: tmp), playlistUrl: url, referer: referer, to: part)
        } else {
            try FileManager.default.copyItem(at: tmp, to: part)
            let size = Int64(Self.fileSize(part) ?? 0)
            // прогресс шлёт делегат загрузки; здесь только финальная точка
            report(ratio: total > 0 ? Double(size) / Double(total) : 1.0, downloaded: size, total: total, speed: nil, eta: nil)
        }
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: part, to: target)
        return target
    }

    private func downloadFile(_ request: URLRequest) async throws -> (URL, URLResponse) {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<(URL, URLResponse), Error>) in
                let task = session.downloadTask(with: request) { url, response, error in
                    self.taskLock.lock()
                    self.activeTask = nil
                    self.taskLock.unlock()
                    if let error = error {
                        cont.resume(throwing: error)
                    } else if let url = url, let response = response {
                        cont.resume(returning: (url, response))
                    } else {
                        cont.resume(throwing: NSError(hockey: "пустой ответ"))
                    }
                }
                taskLock.lock()
                activeTask = task
                taskLock.unlock()
                task.resume()
            }
        } onCancel: {
            taskLock.lock()
            let task = activeTask
            taskLock.unlock()
            task?.cancel()
        }
    }

    private func checkCancelled(_ response: URLResponse) throws {
        if cancelled { throw NSError(hockey: "отменено") }
        guard let http = response as? HTTPURLResponse else { throw NSError(hockey: "нет ответа") }
        if (300...399).contains(http.statusCode) { throw NSError(hockey: "VK просит войти в аккаунт — это видео недоступно без входа") }
        guard (200...299).contains(http.statusCode) else { throw NSError(hockey: "ответ \(http.statusCode)") }
    }

    // ---------- HLS: fMP4-сегменты склеиваются в один mp4 ----------

    private func downloadHls(_ playlistBytes: Data, playlistUrl: URL, referer: String, to part: URL) async throws {
        var playlist = String(decoding: playlistBytes, as: UTF8.self)
        var playlistUrl = playlistUrl
        // мастер-плейлист: берём вариант с наибольшим bandwidth
        if playlist.contains("#EXT-X-STREAM-INF"), let best = Self.bestVariant(playlist) {
            let next = try await http(Self.resolve(playlistUrl, best), method: "GET", body: nil, referer: referer)
            playlist = String(decoding: next, as: UTF8.self)
            playlistUrl = URL(string: Self.resolve(playlistUrl, best)) ?? playlistUrl
        }
        let initUri = Self.firstMatch("#EXT-X-MAP:URI=\"([^\"]+)\"", in: playlist)
        var segments: [String] = []
        var ts = false
        for line in playlist.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let seg = Self.resolve(playlistUrl, trimmed)
            let path = seg.components(separatedBy: CharacterSet(charactersIn: "?#"))[0].lowercased()
            if path.hasSuffix(".ts") || path.hasSuffix(".m2ts") { ts = true }
            segments.append(seg)
        }
        if segments.isEmpty { throw NSError(hockey: "в плейлисте нет сегментов") }
        if ts { throw NSError(hockey: "это видео отдаётся MPEG-TS, на телефоне его не собрать — откройте на компьютере") }

        FileManager.default.createFile(atPath: part.path, contents: nil)
        guard let handle = FileHandle(forWritingTo: part) else { throw NSError(hockey: "не создать файл") }
        defer { try? handle.close() }
        let totalSteps = segments.count + (initUri != nil ? 1 : 0)
        var step = 0
        var bytes = 0
        let started = Date()
        var lastNotify = Date.distantPast
        func tick() {
            let now = Date()
            if now.timeIntervalSince(lastNotify) > 0.3 {
                lastNotify = now
                let ms = max(0.001, now.timeIntervalSince(started))
                report(ratio: Double(step) / Double(totalSteps), downloaded: Int64(bytes), total: -1, speed: Int64(Double(bytes) / ms), eta: nil)
            }
        }
        if let initUri = initUri {
            let data = try await http(Self.resolve(playlistUrl, initUri), method: "GET", body: nil, referer: referer)
            handle.write(data)
            bytes += data.count
            step += 1
        }
        for seg in segments {
            if cancelled { throw NSError(hockey: "отменено") }
            let data = try await http(Self.resolve(URL(string: playlistUrl.absoluteString)!, seg), method: "GET", body: nil, referer: referer)
            handle.write(data)
            bytes += data.count
            step += 1
            tick()
        }
    }

    private static func bestVariant(_ playlist: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: "#EXT-X-STREAM-INF:[^\\n]*BANDWIDTH=(\\d+)[^\\n]*\\n([^\\n#]+)") else { return nil }
        var best: String?
        var bestBw = Int64(-1)
        for m in re.matches(in: playlist, range: NSRange(playlist.startIndex..., in: playlist)) {
            guard
                let bwRange = Range(m.range(at: 1), in: playlist),
                let urlRange = Range(m.range(at: 2), in: playlist),
                let bw = Int64(playlist[bwRange])
            else { continue }
            if bw > bestBw {
                bestBw = bw
                best = playlist[urlRange].trimmingCharacters(in: .whitespaces)
            }
        }
        return best
    }

    private static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    // ---------- http для коротких ответов ----------

    private func http(_ raw: String, method: String, body: String?, referer: String?) async throws -> Data {
        guard let url = URL(string: raw), raw.hasPrefix("http") else { throw NSError(hockey: "плохой адрес") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(Self.ua, forHTTPHeaderField: "User-Agent")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        // al_video.php без этих заголовков отвечает «неизвестная ошибка»
        if method == "POST" {
            request.setValue("XMLHttpRequest", forHTTPHeaderField: "X-Requested-With")
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        }
        if let referer = referer { request.setValue(referer, forHTTPHeaderField: "Referer") }
        if let body = body { request.httpBody = body.data(using: .utf8) }
        let (data, response) = try await session.data(for: request)
        try checkCancelled(response)
        if data.count > Self.maxTextBytes { throw NSError(hockey: "ответ слишком большой") }
        return data
    }

    static func resolve(_ base: URL, _ ref: String) -> String {
        if ref.hasPrefix("http") { return ref }
        return URL(string: ref, relativeTo: base)?.absoluteString ?? ref
    }

    // ---------- прогресс и имена ----------

    private func report(ratio: Double?, downloaded: Int64, total: Int64, speed: Int64?, eta: Int64?) {
        let payload = JSObject.empty()
        payload.put("phase", "video")
        payload.put("ratio", ratio as Any)
        payload.put("downloaded", downloaded)
        payload.put("total", total > 0 ? total : NSNull())
        if let speed = speed { payload.put("speed", speed) } else { payload.put("speed", NSNull()) }
        if let eta = eta { payload.put("eta", eta) } else { payload.put("eta", NSNull()) }
        payload.put("title", NSNull())
        notifyListeners("vkProgress", payload)
    }

    /** «Видео.mp4», «Видео (2).mp4»… */
    static func uniqueFile(_ file: URL) -> URL {
        guard FileManager.default.fileExists(atPath: file.path) else { return file }
        let name = file.deletingPathExtension().lastPathComponent
        let ext = file.pathExtension
        var i = 2
        while true {
            let next = file.deletingLastPathComponent().appendingPathComponent("\(name) (\(i)).\(ext)")
            if !FileManager.default.fileExists(atPath: next.path) { return next }
            i += 1
        }
    }

    static func safeName(_ name: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|")
        var clean = name.unicodeScalars
            .split(whereSeparator: { forbidden.contains($0) || $0.value < 32 })
            .map { String(String.UnicodeScalarView($0)) }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        if clean.count > 120 { clean = String(clean.prefix(120)) }
        return clean.isEmpty || !clean.contains(".") ? "Видео VK.mp4" : clean
    }

    static func fileSize(_ url: URL) -> Int? {
        return (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
    }
}
