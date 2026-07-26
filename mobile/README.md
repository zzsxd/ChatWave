# ChatWave for iOS

Нативная iOS-оболочка текущего ChatWave на Capacitor/WKWebView.

## Требования

- macOS
- Xcode 26 или новее
- Node.js 22 или новее
- Apple Developer account для установки на реальные устройства и TestFlight

## Первый запуск

```bash
cd mobile
npm install
npm run ios:sync
npm run ios:open
```

В Xcode выберите target `App`, укажите свою Team в Signing & Capabilities и
запустите приложение на симуляторе или iPhone.

## TestFlight

1. Создайте приложение `ChatWave` с Bundle ID `io.chatwave.ios` в App Store
   Connect.
2. В Xcode укажите Team в `Signing & Capabilities`.
3. Выберите `Any iOS Device (arm64)`, затем `Product → Archive`.
4. В Organizer нажмите `Distribute App → App Store Connect → Upload`.

CI в `.github/workflows/ios.yml` дополнительно собирает неподписанную версию
для iOS Simulator. Для TestFlight всё равно нужны сертификат и provisioning
profile владельца Apple Developer account.

## Android

Поддерживается Android 7 (API 24) и новее.

```bash
cd mobile
npm install
npm run android:sync
npm run android:open
```

В Android Studio выберите подключённый телефон или эмулятор и нажмите Run.
Для локальной APK-сборки используйте JDK 21:

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  npm run android:apk
```

На внешних macOS-дисках временный каталог Gradle рекомендуется перенаправить
через `CHATWAVE_ANDROID_BUILD_DIR`, чтобы служебные AppleDouble-файлы не
попадали в Android resources.

## Возможности первой версии

- регистрация, авторизация и текущие чаты;
- E2EE-хранилище остаётся локальным для iOS WebView;
- фото, видео, голосовые сообщения, камера и микрофон;
- безопасные области iPhone и сохранение сессии;
- открытие внешних ссылок в Safari.

Демонстрация экрана из iOS-приложения потребует отдельного ReplayKit Broadcast
Upload Extension. Входящие звонки при полностью закрытом приложении потребуют
APNs + CallKit/PushKit.
