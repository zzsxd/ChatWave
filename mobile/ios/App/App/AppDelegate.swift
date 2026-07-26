import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// Native container for the production ChatWave web client.
///
/// The URL is configured here instead of `server.url`, because Capacitor marks
/// that setting as a development/live-reload option. Keeping the host allowlist
/// narrow also means links to third-party sites continue to open in Safari.
@objc(ChatWaveViewController)
final class ChatWaveViewController: CAPBridgeViewController {
    private static let appURL = "https://app.chatwave.62-113-44-238.sslip.io/"
    private static let appHost = "app.chatwave.62-113-44-238.sslip.io"
    private static let navigationTimeout: TimeInterval = 12

    private var watchdogTimer: Timer?
    private var navigationStartedAt = Date()
    private var checkInFlight = false
    private var webStateCheckID = 0
    private var consecutiveCheckFailures = 0
    private var retryCount = 0

    private lazy var loadingOverlay: UIView = {
        let overlay = UIView()
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.backgroundColor = UIColor(
            red: 8 / 255,
            green: 13 / 255,
            blue: 23 / 255,
            alpha: 1
        )

        let logo = UIImageView(image: UIImage(named: "ChatWaveLogo"))
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .scaleAspectFit
        logo.layer.cornerRadius = 24
        logo.clipsToBounds = true

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "ChatWave"
        title.textColor = .white
        title.font = .systemFont(ofSize: 28, weight: .bold)
        title.textAlignment = .center

        loadingStatus.translatesAutoresizingMaskIntoConstraints = false
        loadingStatus.text = "Подключаемся…"
        loadingStatus.textColor = UIColor(
            red: 151 / 255,
            green: 165 / 255,
            blue: 188 / 255,
            alpha: 1
        )
        loadingStatus.font = .systemFont(ofSize: 14, weight: .regular)
        loadingStatus.textAlignment = .center
        loadingStatus.numberOfLines = 0

        loadingSpinner.translatesAutoresizingMaskIntoConstraints = false
        loadingSpinner.color = UIColor(
            red: 113 / 255,
            green: 219 / 255,
            blue: 1,
            alpha: 1
        )
        loadingSpinner.startAnimating()

        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.setTitle("Повторить", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        retryButton.backgroundColor = UIColor(
            red: 47 / 255,
            green: 124 / 255,
            blue: 1,
            alpha: 1
        )
        retryButton.layer.cornerRadius = 14
        retryButton.contentEdgeInsets = UIEdgeInsets(
            top: 12,
            left: 24,
            bottom: 12,
            right: 24
        )
        retryButton.isHidden = true
        retryButton.addTarget(
            self,
            action: #selector(retryButtonPressed),
            for: .touchUpInside
        )

        let stack = UIStackView(
            arrangedSubviews: [
                logo,
                title,
                loadingStatus,
                loadingSpinner,
                retryButton
            ]
        )
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(22, after: logo)
        stack.setCustomSpacing(8, after: loadingStatus)
        overlay.addSubview(stack)

        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 104),
            logo.heightAnchor.constraint(equalToConstant: 104),
            loadingStatus.widthAnchor.constraint(lessThanOrEqualToConstant: 310),
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.leadingAnchor.constraint(
                greaterThanOrEqualTo: overlay.safeAreaLayoutGuide.leadingAnchor,
                constant: 24
            ),
            stack.trailingAnchor.constraint(
                lessThanOrEqualTo: overlay.safeAreaLayoutGuide.trailingAnchor,
                constant: -24
            )
        ])
        return overlay
    }()

    private let loadingStatus = UILabel()
    private let loadingSpinner = UIActivityIndicatorView(style: .medium)
    private let retryButton = UIButton(type: .system)

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.serverURL = Self.appURL
        descriptor.allowedNavigationHostnames = [
            "app.chatwave.62-113-44-238.sslip.io"
        ]
        return descriptor
    }

    override func webViewConfiguration(
        for instanceConfiguration: InstanceConfiguration
    ) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(
            for: instanceConfiguration
        )
        configuration.websiteDataStore = .default()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsInlineMediaPlayback = true
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        view.backgroundColor = UIColor(
            red: 8 / 255,
            green: 13 / 255,
            blue: 23 / 255,
            alpha: 1
        )
        webView?.isOpaque = false
        webView?.scrollView.keyboardDismissMode = .interactive
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        installLoadingOverlay()
        startNavigationWatchdog()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        watchdogTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    private func installLoadingOverlay() {
        guard loadingOverlay.superview == nil else {
            view.bringSubviewToFront(loadingOverlay)
            return
        }
        view.addSubview(loadingOverlay)
        NSLayoutConstraint.activate([
            loadingOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            loadingOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            loadingOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            loadingOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        view.bringSubviewToFront(loadingOverlay)
    }

    private func startNavigationWatchdog() {
        watchdogTimer?.invalidate()
        navigationStartedAt = Date()
        let timer = Timer(timeInterval: 0.75, repeats: true) {
            [weak self] _ in
            self?.checkWebViewState()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchdogTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            [weak self] in
            self?.checkWebViewState()
        }
    }

    private func checkWebViewState() {
        guard !checkInFlight, let webView else { return }

        let currentHost = webView.url?.host
        if currentHost != Self.appHost {
            showLoading(message: "Подключаемся…", showRetry: retryCount > 0)
            if Date().timeIntervalSince(navigationStartedAt) >= 1 {
                loadChatWave()
            }
            return
        }

        checkInFlight = true
        webStateCheckID += 1
        let checkID = webStateCheckID
        webView.evaluateJavaScript(
            """
            (document.readyState === 'interactive' ||
             document.readyState === 'complete') &&
            document.querySelector('.app-canvas, .auth-page') !== null
            """
        ) { [weak self] result, error in
            guard let self else { return }
            guard self.webStateCheckID == checkID else { return }
            self.checkInFlight = false

            if error == nil, (result as? Bool) == true {
                self.consecutiveCheckFailures = 0
                self.retryCount = 0
                self.hideLoadingOverlay()
                return
            }

            self.consecutiveCheckFailures += 1
            if self.consecutiveCheckFailures >= 2 {
                self.showLoading(
                    message: "Восстанавливаем соединение…",
                    showRetry: self.retryCount > 0
                )
            }
            if Date().timeIntervalSince(self.navigationStartedAt)
                >= Self.navigationTimeout {
                self.loadChatWave()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            [weak self] in
            guard let self else { return }
            guard self.webStateCheckID == checkID, self.checkInFlight else {
                return
            }
            self.checkInFlight = false
            self.consecutiveCheckFailures += 1
            self.showLoading(
                message: "Восстанавливаем соединение…",
                showRetry: self.retryCount > 0
            )
            if Date().timeIntervalSince(self.navigationStartedAt)
                >= Self.navigationTimeout {
                self.loadChatWave()
            }
        }
    }

    private func loadChatWave() {
        guard let webView, var components = URLComponents(
            string: Self.appURL
        ) else { return }

        retryCount += 1
        navigationStartedAt = Date()
        consecutiveCheckFailures = 0
        checkInFlight = false
        webStateCheckID += 1
        showLoading(
            message: retryCount > 1
                ? "Повторяем подключение…"
                : "Подключаемся…",
            showRetry: retryCount > 1
        )

        components.queryItems = [
            URLQueryItem(
                name: "ios-reload",
                value: String(Int(Date().timeIntervalSince1970))
            )
        ]
        guard let url = components.url else { return }

        webView.stopLoading()
        webView.load(
            URLRequest(
                url: url,
                cachePolicy: .reloadRevalidatingCacheData,
                timeoutInterval: Self.navigationTimeout
            )
        )
    }

    private func showLoading(message: String, showRetry: Bool) {
        installLoadingOverlay()
        loadingStatus.text = message
        retryButton.isHidden = !showRetry
        loadingSpinner.startAnimating()
        loadingOverlay.isHidden = false
        loadingOverlay.alpha = 1
        view.bringSubviewToFront(loadingOverlay)
    }

    private func hideLoadingOverlay() {
        guard !loadingOverlay.isHidden else { return }
        UIView.animate(
            withDuration: 0.18,
            animations: {
                self.loadingOverlay.alpha = 0
            },
            completion: { _ in
                self.loadingOverlay.isHidden = true
                self.loadingSpinner.stopAnimating()
            }
        )
    }

    @objc private func retryButtonPressed() {
        loadChatWave()
    }

    @objc private func applicationDidBecomeActive() {
        navigationStartedAt = Date()
        consecutiveCheckFailures = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            [weak self] in
            self?.checkWebViewState()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }
}
