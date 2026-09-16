import Foundation
import WebKit

final class OpenedProjectBridge: NSObject, WKScriptMessageHandler {
    private let lastProjectPathKey = "lastProjectPath"
    private let projectDirectoryName = "一一编程乐园"

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let base64 = body["data"] as? String,
              let data = Data(base64Encoded: base64) else {
            return
        }

        let filename = (body["filename"] as? String) ?? "未命名作品.sb3"
        let title = URL(fileURLWithPath: filename).deletingPathExtension().lastPathComponent

        do {
            let documents = try FileManager.default.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let directory = documents.appendingPathComponent(projectDirectoryName, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let url = directory.appendingPathComponent("\(sanitizeFilename(title)).sb3")
            try data.write(to: url, options: .atomic)
            UserDefaults.standard.set(
                "\(projectDirectoryName)/\(url.lastPathComponent)",
                forKey: lastProjectPathKey
            )
        } catch {
            print("Failed to remember opened Scratch project: \(error)")
        }
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
}
