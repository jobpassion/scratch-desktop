import UIKit
import WebKit

final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private(set) var webView: WKWebView!
    private var bridge: WebBridge!
    private var openedProjectBridge: OpenedProjectBridge!

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        bridge = WebBridge()
        openedProjectBridge = OpenedProjectBridge()
        configuration.userContentController.add(bridge, name: "yiyiBridge")
        configuration.userContentController.add(openedProjectBridge, name: "yiyiFileBridge")

        webView = WKWebView(frame: .zero, configuration: configuration)
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        bridge.attach(host: self, webView: webView)

        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadScratch()
    }

    private func loadScratch() {
        guard let webRoot = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
              let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            showMissingBundle()
            return
        }
        webView.loadFileURL(indexURL, allowingReadAccessTo: webRoot)
    }

    private func showMissingBundle() {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.text = "iOS Web 资源不存在。\n请先在仓库根目录运行 npm ci 和 npm run build:ios:web。"
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(
            title: "一一编程乐园",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in
            completionHandler(false)
        })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in
            completionHandler(true)
        })
        present(alert, animated: true)
    }

    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    override var prefersStatusBarHidden: Bool {
        true
    }

    override var prefersHomeIndicatorAutoHidden: Bool {
        true
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        [.bottom]
    }
}
