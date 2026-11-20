import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import AVFoundation

/** Папка приложения для скачанных из VK видео — общая для HockeyFiles и HockeyVk. */
internal func hockeyVkDir() -> URL {
    let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("VK", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

internal extension NSError {
    convenience init(hockey description: String) {
        self.init(domain: "Hockey", code: -1, userInfo: [NSLocalizedDescriptionKey: description])
    }
}

private func pickedObject(_ uri: String?, _ name: String?) -> JSObject {
    var ret = JSObject()
    if let uri = uri { ret["uri"] = uri }
    if let name = name { ret["name"] = name }
    return ret
}

/// Файлы на iPhone через системный выбор документов: видео матча и файл проекта.
/// Выбранные файлы запоминаются по stableId, поэтому проект открывается и после перезапуска
/// (аналог persistable-разрешений SAF на Android).
@objc(HockeyFilesPlugin)
public class HockeyFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HockeyFilesPlugin"
    public let pluginName = "HockeyFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveVideo", returnType: CAPPluginReturnPromise)
    ]

    /** Проект больше этого — не наш файл. */
    private static let maxProjectBytes = 20 * 1024 * 1024

    private var pendingCall: CAPPluginCall?
    private var pickerMode = ""
    private var createText = ""
    private var createData = Data()

    // ---------- выбор ----------

    @objc func pickVideo(_ call: CAPPluginCall) {
        begin(call, mode: "video", picker: UIDocumentPickerViewController(forOpeningContentTypes: [.movie, .video, .mpeg4Movie, .quickTimeMovie]))
    }

    @objc func pickProject(_ call: CAPPluginCall) {
        // мессенджеры и почта сохраняют json как plain/text или данные
        begin(call, mode: "project", picker: UIDocumentPickerViewController(forOpeningContentTypes: [.json, .text, .plainText, .data]))
    }

    @objc func createDocument(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("Нет текста")
            return
        }
        createText = text
        begin(call, mode: "create", picker: UIDocumentPickerViewController(forCreatingContentTypes: [.json]))
    }

    /** Клип момента: пользователь выбирает, куда сохранить mp4, пишем байты. */
    @objc func saveVideo(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"), let data = Data(base64Encoded: b64) else {
            call.reject("Нет данных")
            return
        }
        createData = data
        begin(call, mode: "createVideo", picker: UIDocumentPickerViewController(forCreatingContentTypes: [.mpeg4Movie]))
    }

    private func begin(_ call: CAPPluginCall, mode: String, picker: UIDocumentPickerViewController) {
        guard let root = bridge?.viewController ?? UIApplication.shared.keyWindow?.rootViewController else {
            call.reject("Нет активного экрана")
            return
        }
        pendingCall?.resolve(pickedObject(nil, nil))
        pendingCall = call
        pickerMode = mode
        picker.delegate = self
        picker.allowsMultipleSelection = false
        DispatchQueue.main.async { root.present(picker, animated: true) }
    }

    // ---------- запись в уже выбранный файл ----------

    @objc func writeDocument(_ call: CAPPluginCall) {
        guard let raw = call.getString("uri"), let text = call.getString("text") else {
            call.reject("Нет uri или текста")
            return
        }
        guard let url = resolveFile(raw), canWrite(url) else {
            call.reject("Нет права записи в этот файл — сохраните как новый")
            return
        }
        DispatchQueue.global().async {
            self.writeText(url, text: text) { error in
                if let error = error { call.reject("Не удалось сохранить: \(error)") } else { call.resolve() }
            }
        }
    }

    // ---------- разбор видео ----------

    /** Длительность, размер кадра (с учётом поворота), fps и кодек видео. */
    @objc func probe(_ call: CAPPluginCall) {
        guard let raw = call.getString("uri") else {
            call.reject("Нет uri")
            return
        }
        // свои скачанные из VK читаем всегда; чужие — только которые пользователь сам выбрал
        guard let url = resolveFile(raw), canRead(url) else {
            call.reject("Видео не выбрано на этом устройстве")
            return
        }
        DispatchQueue.global().async {
            do {
                call.tryResolve(try self.describe(url))
            } catch {
                call.reject("Видео недоступно: \(error.localizedDescription)")
            }
        }
    }

    private func describe(_ url: URL) throws -> JSObject {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw NSError(hockey: "в файле нет видеодорожки")
        }
        let duration = CMTimeGetSeconds(asset.duration)
        var size = track.naturalSize
        let transform = track.preferredTransform
        // видео с телефона, снятое вертикально, хранится «лёжа» с пометкой поворота
        if abs(transform.b) > 0.5 || abs(transform.c) > 0.5 {
            size = CGSize(width: size.height, height: size.width)
        }
        var fps = Double(track.nominalFrameRate)
        let codec: String
        if let desc = track.formatDescriptions.first {
            codec = fourCC(CMFormatDescriptionGetMediaSubType(desc as! CMFormatDescription))
        } else {
            codec = "video/unknown"
        }
        var ret = JSObject()
        ret["duration"] = duration
        ret["width"] = Int(size.width.rounded())
        ret["height"] = Int(size.height.rounded())
        ret["fps"] = fps > 0 ? fps : 30
        ret["codec"] = codec
        ret["name"] = url.lastPathComponent
        return ret
    }

    private func fourCC(_ code: FourCharCode) -> String {
        let bytes = [UInt8((code >> 24) & 255), UInt8((code >> 16) & 255), UInt8((code >> 8) & 255), UInt8(code & 255)]
        let s = (String(bytes: bytes, encoding: .ascii) ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        return "video/" + (s.isEmpty ? "unknown" : s)
    }

    // ---------- права на файлы ----------

    /** Файл доступен: свой (скачанный из VK) или выбранный пользователем. */
    private func canRead(_ url: URL) -> Bool {
        return HockeyAccess.isReadable(url)
    }

    private func canWrite(_ url: URL) -> Bool {
        // на iOS доступ к выбранному файлу даётся сразу и на чтение, и на запись
        return HockeyAccess.isReadable(url)
    }

    private func remember(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        HockeyAccess.remember(url)
    }

    /** uri из JS → URL: file://… или обычный путь. */
    private func resolveFile(_ raw: String) -> URL? {
        if raw.hasPrefix("file://") { return URL(string: raw) }
        if raw.hasPrefix("/") { return URL(fileURLWithPath: raw) }
        return nil
    }

    private func readText(_ url: URL, _ call: CAPPluginCall, writable: Bool) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        DispatchQueue.global().async {
            do {
                let data = try Data(contentsOf: url)
                if data.count > Self.maxProjectBytes { throw NSError(hockey: "файл слишком большой для проекта") }
                guard let text = String(data: data, encoding: .utf8) else { throw NSError(hockey: "файл не читается как текст") }
                var ret = pickedObject(url.absoluteString, url.lastPathComponent)
                ret["text"] = text
                ret["writable"] = writable
                call.resolve(ret)
            } catch {
                call.reject("Не удалось прочитать файл: \(error.localizedDescription)")
            }
        }
    }

    private func writeText(_ url: URL, text: String, done: @escaping (String?) -> Void) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            // запись атомарная и с полной заменой содержимого — хвоста старого файла не остаётся
            try text.data(using: .utf8)?.write(to: url, options: .atomic)
            done(nil)
        } catch {
            done(error.localizedDescription)
        }
    }
}

// ---------- результаты выбора ----------

extension HockeyFilesPlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let url = urls.first else {
            call.resolve(pickedObject(nil, nil))
            return
        }
        remember(url)
        switch pickerMode {
        case "project":
            readText(url, call, writable: true)
        case "create":
            DispatchQueue.global().async {
                self.writeText(url, text: self.createText) { error in
                    if let error = error { call.reject("Не удалось сохранить: \(error)") } else { call.resolve(pickedObject(url.absoluteString, url.lastPathComponent)) }
                }
            }
        case "createVideo":
            DispatchQueue.global().async {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    try self.createData.write(to: url, options: .atomic)
                    call.resolve(pickedObject(url.absoluteString, url.lastPathComponent))
                } catch {
                    call.reject("Не удалось сохранить: \(error.localizedDescription)")
                }
            }
        default:
            call.resolve(pickedObject(url.absoluteString, url.lastPathComponent))
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(pickedObject(nil, nil))
        pendingCall = nil
    }
}
