import UIKit
import WebKit
import AVFoundation
import UniformTypeIdentifiers

final class WebBridge: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate {
    private weak var host: UIViewController?
    private weak var webView: WKWebView?
    private let bluetooth = BluetoothBridge()
    private let speechSynthesizer = AVSpeechSynthesizer()
    private var pendingOpenProjectRequestId: Int?
    private var pendingExportProjectRequestId: Int?
    private var pendingExportURL: URL?
    private var simulationController: SimulationViewController?

    private let lastProjectPathKey = "lastProjectPath"
    private let projectDirectoryName = "一一编程乐园"

    override init() {
        super.init()
        bluetooth.eventSink = { [weak self] name, payload in
            self?.emit(name: name, payload: payload)
        }
    }

    func attach(host: UIViewController, webView: WKWebView) {
        self.host = host
        self.webView = webView
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let method = body["method"] as? String else {
            return
        }
        let params = body["params"] as? [String: Any] ?? [:]
        handle(id: id, method: method, params: params)
    }

    private func handle(id: Int, method: String, params: [String: Any]) {
        switch method {
        case "getInitialProjectData":
            getInitialProjectData(id: id)
        case "openProject":
            openProject(id: id)
        case "quickSaveProject":
            quickSaveProject(id: id, params: params)
        case "exportProject":
            exportProject(id: id, params: params)
        case "clearCurrentProject":
            clearCurrentProject(id: id)
        case "readBundleFile":
            readBundleFile(id: id, params: params)
        case "speakText":
            speakText(id: id, params: params)
        case "showError":
            showError(id: id, params: params)
        case "openAbout":
            openAbout(id: id)
        case "openPrivacy":
            openPrivacy(id: id)
        case "bluetoothConnect":
            bluetooth.connect { [weak self] result in
                self?.resolve(id: id, result: result.map { ["connected": true] })
            }
        case "bluetoothDisconnect":
            bluetooth.disconnect { [weak self] result in
                self?.resolve(id: id, result: result.map { ["connected": false] })
            }
        case "bluetoothWrite":
            guard let base64 = params["data"] as? String,
                  let data = Data(base64Encoded: base64) else {
                reject(id: id, message: "蓝牙数据格式无效。")
                return
            }
            bluetooth.write(data) { [weak self] result in
                self?.resolve(id: id, result: result.map { ["written": data.count] })
            }
        case "openSimulation":
            openSimulation(id: id, params: params)
        case "captureSimulation":
            captureSimulation(id: id)
        case "closeSimulation":
            closeSimulation(id: id)
        default:
            reject(id: id, message: "Unsupported native method: \(method)")
        }
    }

    private func getInitialProjectData(id: Int) {
        do {
            guard let url = try resolveLastProjectURL() else {
                resolve(id: id, payload: NSNull())
                return
            }
            let data = try Data(contentsOf: url)
            resolve(id: id, payload: [
                "data": data.base64EncodedString(),
                "title": url.deletingPathExtension().lastPathComponent
            ])
        } catch {
            UserDefaults.standard.removeObject(forKey: lastProjectPathKey)
            reject(id: id, error: error)
        }
    }

    private func openProject(id: Int) {
        guard pendingOpenProjectRequestId == nil,
              pendingExportProjectRequestId == nil,
              let host else {
            reject(id: id, message: "文件选择器正在使用中。")
            return
        }
        pendingOpenProjectRequestId = id
        let sb3Type = UTType(filenameExtension: "sb3") ?? .data
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [sb3Type, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        host.present(picker, animated: true)
    }

    private func exportProject(id: Int, params: [String: Any]) {
        guard pendingOpenProjectRequestId == nil,
              pendingExportProjectRequestId == nil,
              let host else {
            reject(id: id, message: "文件选择器正在使用中。")
            return
        }
        guard let base64 = params["data"] as? String,
              let data = Data(base64Encoded: base64) else {
            reject(id: id, message: "Scratch 作品数据无效。")
            return
        }

        let requestedFilename = (params["filename"] as? String) ?? "未命名作品.sb3"
        let requestedTitle = URL(fileURLWithPath: requestedFilename)
            .deletingPathExtension()
            .lastPathComponent
        let filename = "\(sanitizeFilename(requestedTitle)).sb3"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

        do {
            if FileManager.default.fileExists(atPath: tempURL.path) {
                try FileManager.default.removeItem(at: tempURL)
            }
            try data.write(to: tempURL, options: .atomic)
            pendingExportProjectRequestId = id
            pendingExportURL = tempURL

            let picker = UIDocumentPickerViewController(forExporting: [tempURL], asCopy: true)
            picker.delegate = self
            host.present(picker, animated: true)
        } catch {
            cleanupPendingExport()
            reject(id: id, error: error)
        }
    }

    private func clearCurrentProject(id: Int) {
        UserDefaults.standard.removeObject(forKey: lastProjectPathKey)
        resolve(id: id, payload: ["cleared": true])
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let id = pendingExportProjectRequestId {
            cleanupPendingExport()
            reject(id: id, message: "cancelled")
            return
        }
        guard let id = pendingOpenProjectRequestId else { return }
        pendingOpenProjectRequestId = nil
        reject(id: id, message: "cancelled")
    }

    func documentPicker(_ controller: UIDocumentPickerViewController,
                        didPickDocumentsAt urls: [URL]) {
        if let id = pendingExportProjectRequestId {
            let exportedName = urls.first?.lastPathComponent ?? pendingExportURL?.lastPathComponent ?? "作品.sb3"
            cleanupPendingExport()
            resolve(id: id, payload: [
                "exported": true,
                "displayPath": exportedName
            ])
            return
        }

        guard let id = pendingOpenProjectRequestId else { return }
        pendingOpenProjectRequestId = nil
        guard let sourceURL = urls.first else {
            reject(id: id, message: "没有选择文件。")
            return
        }
        do {
            let data = try Data(contentsOf: sourceURL)
            let title = sourceURL.deletingPathExtension().lastPathComponent
            let localURL = try availableProjectURL(title: title, excluding: nil)
            try data.write(to: localURL, options: .atomic)
            rememberProjectURL(localURL)
            resolve(id: id, payload: [
                "data": data.base64EncodedString(),
                "title": localURL.deletingPathExtension().lastPathComponent,
                "displayPath": localURL.lastPathComponent
            ])
        } catch {
            reject(id: id, error: error)
        }
    }

    private func cleanupPendingExport() {
        if let url = pendingExportURL {
            try? FileManager.default.removeItem(at: url)
        }
        pendingExportProjectRequestId = nil
        pendingExportURL = nil
    }

    private func quickSaveProject(id: Int, params: [String: Any]) {
        guard let base64 = params["data"] as? String,
              let data = Data(base64Encoded: base64) else {
            reject(id: id, message: "Scratch 作品数据无效。")
            return
        }
        let requestedTitle = (params["title"] as? String) ?? "未命名作品"
        let safeTitle = sanitizeFilename(requestedTitle)

        do {
            let currentURL = try resolveLastProjectURL()
            let saveURL: URL

            if let currentURL,
               currentURL.deletingPathExtension().lastPathComponent == safeTitle {
                saveURL = currentURL
            } else {
                saveURL = try availableProjectURL(title: safeTitle, excluding: currentURL)
            }

            try data.write(to: saveURL, options: .atomic)

            if let currentURL,
               currentURL.standardizedFileURL != saveURL.standardizedFileURL,
               FileManager.default.fileExists(atPath: currentURL.path) {
                try? FileManager.default.removeItem(at: currentURL)
            }

            rememberProjectURL(saveURL)
            resolve(id: id, payload: [
                "title": saveURL.deletingPathExtension().lastPathComponent,
                "displayPath": "文件 App / 一一编程乐园 / \(saveURL.lastPathComponent)"
            ])
        } catch {
            reject(id: id, error: error)
        }
    }

    private func documentsURL() throws -> URL {
        try FileManager.default.url(
            for: .documentDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
    }

    private func projectDirectoryURL() throws -> URL {
        let directory = try documentsURL().appendingPathComponent(projectDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
    }

    private func rememberProjectURL(_ url: URL) {
        UserDefaults.standard.set(
            "\(projectDirectoryName)/\(url.lastPathComponent)",
            forKey: lastProjectPathKey
        )
    }

    private func resolveLastProjectURL() throws -> URL? {
        guard let stored = UserDefaults.standard.string(forKey: lastProjectPathKey),
              !stored.isEmpty else {
            return nil
        }

        let fileManager = FileManager.default
        let projectDirectory = try projectDirectoryURL()

        // Older builds stored the full sandbox path. Xcode/App updates can move the
        // data container and invalidate that absolute prefix even though Documents
        // and the saved project still exist. Recover by filename in the current
        // Documents container and migrate the preference to a relative reference.
        if stored.hasPrefix("/") {
            let legacyURL = URL(fileURLWithPath: stored)
            let currentURL = projectDirectory.appendingPathComponent(legacyURL.lastPathComponent)
            if fileManager.fileExists(atPath: currentURL.path) {
                rememberProjectURL(currentURL)
                return currentURL
            }
            if fileManager.fileExists(atPath: legacyURL.path) {
                rememberProjectURL(legacyURL)
                return legacyURL
            }
            UserDefaults.standard.removeObject(forKey: lastProjectPathKey)
            return nil
        }

        let components = stored.split(separator: "/").map(String.init)
        guard !components.isEmpty,
              !components.contains("..") else {
            UserDefaults.standard.removeObject(forKey: lastProjectPathKey)
            return nil
        }

        let url: URL
        if components.count == 1 {
            // Accept an early relative format which stored only the filename.
            url = projectDirectory.appendingPathComponent(components[0])
        } else {
            var candidate = try documentsURL()
            for component in components {
                candidate.appendPathComponent(component)
            }
            url = candidate
        }

        guard fileManager.fileExists(atPath: url.path) else {
            UserDefaults.standard.removeObject(forKey: lastProjectPathKey)
            return nil
        }
        return url
    }

    private func projectURL(title: String) throws -> URL {
        let safeTitle = sanitizeFilename(title)
        return try projectDirectoryURL().appendingPathComponent("\(safeTitle).sb3")
    }

    private func availableProjectURL(title: String, excluding currentURL: URL?) throws -> URL {
        let safeTitle = sanitizeFilename(title)
        let directory = try projectDirectoryURL()
        let fileManager = FileManager.default
        let preferred = directory.appendingPathComponent("\(safeTitle).sb3")

        if let currentURL,
           currentURL.standardizedFileURL == preferred.standardizedFileURL {
            return preferred
        }
        if !fileManager.fileExists(atPath: preferred.path) {
            return preferred
        }

        for index in 2...9999 {
            let candidate = directory.appendingPathComponent("\(safeTitle) \(index).sb3")
            if let currentURL,
               currentURL.standardizedFileURL == candidate.standardizedFileURL {
                return candidate
            }
            if !fileManager.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        throw NSError(
            domain: "YiyiCoding.Files",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "无法为作品生成可用文件名。"]
        )
    }

    private func sanitizeFilename(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let invalid = CharacterSet(charactersIn: "<>:\"/\\|?*")
            .union(.controlCharacters)
        let pieces = trimmed.unicodeScalars.map { scalar -> String in
            invalid.contains(scalar) ? "_" : String(scalar)
        }
        let value = pieces.joined()
            .trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        return value.isEmpty ? "未命名作品" : value
    }

    private func readBundleFile(id: Int, params: [String: Any]) {
        guard let relativePath = params["path"] as? String,
              !relativePath.hasPrefix("/"),
              !relativePath.components(separatedBy: "/").contains(".."),
              let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
            reject(id: id, message: "资源路径无效。")
            return
        }
        let url = root.appendingPathComponent(relativePath)
        do {
            let data = try Data(contentsOf: url)
            resolve(id: id, payload: ["data": data.base64EncodedString()])
        } catch {
            reject(id: id, error: error)
        }
    }

    private func speakText(id: Int, params: [String: Any]) {
        let text = ((params["text"] as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            resolve(id: id, payload: ["spoken": false])
            return
        }
        if speechSynthesizer.isSpeaking {
            speechSynthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.5
        speechSynthesizer.speak(utterance)
        resolve(id: id, payload: ["spoken": true])
    }

    private func showError(id: Int, params: [String: Any]) {
        let title = (params["title"] as? String) ?? "错误"
        let message = [
            params["message"] as? String,
            params["detail"] as? String
        ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n\n")
        presentAlert(title: title, message: message)
        resolve(id: id, payload: ["shown": true])
    }

    private func openAbout(id: Int) {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        presentAlert(
            title: "一一编程乐园",
            message: "iOS 版\nVersion \(version)"
        )
        resolve(id: id, payload: ["shown": true])
    }

    private func openPrivacy(id: Int) {
        presentAlert(
            title: "隐私说明",
            message: "作品默认保存在本机“文件”App 的一一编程乐园目录。蓝牙仅用于连接附近的 ESP32 开发板。"
        )
        resolve(id: id, payload: ["shown": true])
    }

    private func presentAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        host?.present(alert, animated: true)
    }

    private func openSimulation(id: Int, params: [String: Any]) {
        guard let host else {
            reject(id: id, message: "无法打开仿真窗口。")
            return
        }
        guard let serverString = params["serverUrl"] as? String,
              let baseURL = URL(string: serverString),
              ["http", "https"].contains(baseURL.scheme?.lowercased() ?? ""),
              let snapshot = params["snapshot"],
              JSONSerialization.isValidJSONObject(snapshot) else {
            reject(id: id, message: "仿真服务器地址或电路数据无效。")
            return
        }

        do {
            let snapshotData = try JSONSerialization.data(withJSONObject: snapshot)
            let controller = SimulationViewController(
                serverURL: baseURL,
                snapshotData: snapshotData
            )
            controller.statusSink = { [weak self] status in
                self?.emit(name: "boardSimulationStatus", payload: ["status": status])
            }
            controller.snapshotSink = { [weak self] content in
                self?.emit(name: "boardSimulationSnapshot", payload: ["content": content])
            }
            controller.closeSink = { [weak self, weak controller] in
                guard let self, self.simulationController === controller else { return }
                self.simulationController = nil
            }
            controller.readyCompletion = { [weak self] result in
                switch result {
                case .success:
                    self?.resolve(id: id, payload: ["opened": true])
                case .failure(let error):
                    self?.simulationController = nil
                    self?.reject(id: id, error: error)
                }
            }
            simulationController = controller
            controller.modalPresentationStyle = .fullScreen
            host.present(controller, animated: true)
        } catch {
            reject(id: id, error: error)
        }
    }

    private func captureSimulation(id: Int) {
        guard let simulationController else {
            resolve(id: id, payload: NSNull())
            return
        }
        simulationController.capture { [weak self] result in
            switch result {
            case .success(let content):
                self?.resolve(id: id, payload: ["content": content])
            case .failure(let error):
                self?.reject(id: id, error: error)
            }
        }
    }

    private func closeSimulation(id: Int) {
        guard let simulationController else {
            resolve(id: id, payload: ["closed": true])
            return
        }
        simulationController.closeAndCapture { [weak self] _ in
            self?.simulationController = nil
            self?.resolve(id: id, payload: ["closed": true])
        }
    }

    private func resolve<T>(id: Int, result: Result<T, Error>) {
        switch result {
        case .success(let value):
            resolve(id: id, payload: value)
        case .failure(let error):
            reject(id: id, error: error)
        }
    }

    private func resolve(id: Int, payload: Any) {
        sendJavaScript(function: "__YYNativeBridgeResolve", arguments: [
            id,
            true,
            payload
        ])
    }

    private func reject(id: Int, error: Error) {
        reject(id: id, message: error.localizedDescription)
    }

    private func reject(id: Int, message: String) {
        sendJavaScript(function: "__YYNativeBridgeResolve", arguments: [
            id,
            false,
            ["message": message]
        ])
    }

    private func emit(name: String, payload: Any) {
        sendJavaScript(function: "__YYNativeBridgeEvent", arguments: [name, payload])
    }

    private func sendJavaScript(function: String, arguments: [Any]) {
        guard let webView else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: arguments, options: [.fragmentsAllowed])
            guard let json = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                webView.evaluateJavaScript("\(function).apply(null, \(json));")
            }
        } catch {
            print("Failed to encode bridge callback: \(error)")
        }
    }
}
