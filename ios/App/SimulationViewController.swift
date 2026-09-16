import UIKit
import WebKit

final class SimulationViewController: UIViewController, WKNavigationDelegate {
    private let serverURL: URL
    private let snapshotData: Data
    private var webView: WKWebView!
    private var didFinishInitialLoad = false

    var statusSink: ((String) -> Void)?
    var snapshotSink: ((String) -> Void)?
    var closeSink: (() -> Void)?
    var readyCompletion: ((Result<Void, Error>) -> Void)?

    init(serverURL: URL, snapshotData: Data) {
        self.serverURL = serverURL
        self.snapshotData = snapshotData
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = .systemBackground

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false

        let close = UIButton(type: .system)
        close.setTitle("返回 Scratch", for: .normal)
        close.titleLabel?.font = .boldSystemFont(ofSize: 16)
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false

        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(close)

        root.addSubview(bar)
        root.addSubview(webView)

        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            bar.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            bar.heightAnchor.constraint(equalToConstant: 48),

            close.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            close.centerYAnchor.constraint(equalTo: bar.centerYAnchor),

            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: bar.bottomAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        statusSink?("正在连接仿真服务器…")

        guard let editorURL = URL(string: "editor?from=scratch", relativeTo: normalizedBaseURL())?.absoluteURL else {
            readyCompletion?(.failure(SimulationError.invalidURL))
            return
        }
        webView.load(URLRequest(url: editorURL))
    }

    private func normalizedBaseURL() -> URL {
        var value = serverURL.absoluteString
        if !value.hasSuffix("/") {
            value.append("/")
        }
        return URL(string: value) ?? serverURL
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !didFinishInitialLoad else { return }
        didFinishInitialLoad = true
        statusSink?("正在加载电路并启动 ESP32…")
        loadSnapshot { [weak self] result in
            switch result {
            case .success:
                self?.statusSink?("ESP32 仿真运行中")
                self?.readyCompletion?(.success(()))
            case .failure(let error):
                self?.statusSink?("")
                self?.readyCompletion?(.failure(error))
                self?.dismiss(animated: true)
            }
            self?.readyCompletion = nil
        }
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        failInitialLoad(error)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        failInitialLoad(error)
    }

    private func failInitialLoad(_ error: Error) {
        guard readyCompletion != nil else { return }
        readyCompletion?(.failure(error))
        readyCompletion = nil
    }

    private func loadSnapshot(completion: @escaping (Result<Void, Error>) -> Void) {
        let payload = snapshotData.base64EncodedString()
        let script = """
        const dismissNotices = () => {
            document.querySelectorAll('.velxio-news-ok, .gh-star-banner__close')
                .forEach(button => button.click());
        };
        return await new Promise((resolve, reject) => {
            let attempts = 0;
            const timer = setInterval(() => {
                dismissNotices();
                const input = document.querySelector('input[type="file"][accept*=".vlx"]');
                if (!input) {
                    if (++attempts < 80) return;
                    clearInterval(timer);
                    reject(new Error('Velxio 未准备好加载电路。'));
                    return;
                }
                const viewButtons = document.querySelectorAll('.view-mode-toggle button');
                if (viewButtons.length < 4) {
                    if (++attempts < 80) return;
                    clearInterval(timer);
                    reject(new Error('Velxio 未准备好切换电路视图。'));
                    return;
                }
                clearInterval(timer);
                viewButtons[viewButtons.length - 1].click();
                const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
                const file = new File([bytes], 'scratch-board.vlx', {type: 'application/json'});
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
                input.dispatchEvent(new Event('change', {bubbles: true}));
                setTimeout(() => {
                    dismissNotices();
                    let runAttempts = 0;
                    const runTimer = setInterval(() => {
                        dismissNotices();
                        const boardList = document.querySelector('.file-explorer-list');
                        const runButton = document.querySelector('button.tb-btn-run');
                        if (boardList && boardList.textContent.includes('ESP32') &&
                            runButton && !runButton.disabled) {
                            clearInterval(runTimer);
                            runButton.click();
                            let startAttempts = 0;
                            const startTimer = setInterval(() => {
                                const stopButton = document.querySelector('button.tb-btn-stop');
                                if (stopButton && !stopButton.disabled) {
                                    clearInterval(startTimer);
                                    resolve(true);
                                } else if (++startAttempts >= 360) {
                                    clearInterval(startTimer);
                                    reject(new Error('ESP32 未进入运行状态。'));
                                }
                            }, 250);
                        } else if (++runAttempts >= 120) {
                            clearInterval(runTimer);
                            reject(new Error('Velxio 未能载入 ESP32 程序。'));
                        }
                    }, 100);
                }, 200);
            }, 100);
        });
        """

        webView.callAsyncJavaScript(
            script,
            arguments: ["payload": payload],
            in: nil,
            contentWorld: .page
        ) { result in
            switch result {
            case .success:
                completion(.success(()))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func capture(completion: @escaping (Result<String, Error>) -> Void) {
        guard webView != nil, didFinishInitialLoad else {
            completion(.failure(SimulationError.notReady))
            return
        }
        let script = """
        return await new Promise((resolve, reject) => {
            const buttons = document.querySelectorAll('.file-explorer-header-actions button');
            const saveButton = buttons[buttons.length - 1];
            if (!saveButton) {
                reject(new Error('找不到 Velxio 保存按钮。'));
                return;
            }
            const originalCreateObjectURL = URL.createObjectURL;
            const originalClick = HTMLAnchorElement.prototype.click;
            const restore = () => {
                URL.createObjectURL = originalCreateObjectURL;
                HTMLAnchorElement.prototype.click = originalClick;
            };
            const timer = setTimeout(() => {
                restore();
                reject(new Error('读取仿真电路超时。'));
            }, 5000);
            HTMLAnchorElement.prototype.click = function () {
                if (this.download && this.download.endsWith('.vlx')) return;
                return originalClick.call(this);
            };
            URL.createObjectURL = function (blob) {
                if (blob.type === 'application/json') {
                    blob.text().then(text => {
                        clearTimeout(timer);
                        restore();
                        resolve(text);
                    }, error => {
                        clearTimeout(timer);
                        restore();
                        reject(error);
                    });
                }
                return originalCreateObjectURL.call(URL, blob);
            };
            try {
                saveButton.click();
            } catch (error) {
                clearTimeout(timer);
                restore();
                reject(error);
            }
        });
        """
        webView.callAsyncJavaScript(
            script,
            arguments: [:],
            in: nil,
            contentWorld: .page
        ) { result in
            switch result {
            case .success(let value):
                if let content = value as? String {
                    completion(.success(content))
                } else {
                    completion(.failure(SimulationError.invalidSnapshot))
                }
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func closeAndCapture(completion: @escaping (Result<String, Error>) -> Void) {
        capture { [weak self] result in
            if case .success(let content) = result {
                self?.snapshotSink?(content)
            }
            self?.dismiss(animated: true) {
                self?.closeSink?()
                completion(result)
            }
        }
    }

    @objc private func closeTapped() {
        statusSink?("正在保存仿真电路…")
        closeAndCapture { [weak self] result in
            if case .failure(let error) = result {
                self?.statusSink?("仿真电路保存失败：\(error.localizedDescription)")
            } else {
                self?.statusSink?("")
            }
        }
    }

    enum SimulationError: LocalizedError {
        case invalidURL
        case notReady
        case invalidSnapshot

        var errorDescription: String? {
            switch self {
            case .invalidURL: return "仿真服务器地址无效。"
            case .notReady: return "仿真窗口尚未准备好。"
            case .invalidSnapshot: return "仿真电路数据无效。"
            }
        }
    }
}
