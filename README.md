<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
    <img src="assets/logo-dark.svg" alt="ChatWave" width="180">
  </picture>
</p>

<h1 align="center">ChatWave</h1>

<p align="center">
  Современный open-source мессенджер для самостоятельного размещения.
</p>

ChatWave объединяет личные и групповые чаты, обмен файлами, голосовые и
видеозвонки в одном адаптивном интерфейсе. Проект включает сервер, веб-клиент,
приложения для Windows и macOS, а также мобильные оболочки для Android и iOS.

> Этот репозиторий развивает идеи
> [оригинального ChatWave от lifufkd](https://github.com/lifufkd/ChatWave).
> Спасибо автору исходного проекта за основу.

## Возможности

### Сообщения

- личные и групповые чаты;
- сообщения в реальном времени через WebSocket;
- изображения, видео, файлы и голосовые сообщения;
- просмотр медиа и воспроизведение аудио внутри приложения;
- расшифровка голосовых сообщений в текст;
- ответы, реакции, закрепление, поиск и массовое удаление сообщений;
- индикаторы доставки, прочтения, набора текста и статуса пользователя;
- чат «Избранное» для сообщений самому себе;
- закрепление и сортировка диалогов;
- настраиваемый фон чата.

### Звонки

- личные и групповые аудио- и видеозвонки на WebRTC;
- включение камеры во время аудиозвонка;
- демонстрация экрана и передача системного звука на поддерживаемых платформах;
- выбор камеры, микрофона и устройства вывода;
- настройка громкости участников и демонстрации;
- полноэкранный и компактный режимы;
- история звонков непосредственно в чате;
- STUN/TURN для работы за NAT и корпоративными сетями.

### Аккаунт и безопасность

- регистрация, авторизация и долгоживущая refresh-сессия;
- изменение имени, username, пароля и аватара;
- история аватаров;
- локальное хранение ключей E2EE и recovery key;
- шифрование сообщений на стороне клиента с использованием
  Matrix Crypto WASM;
- JWT-аутентификация, ограничение частоты запросов и проверка загрузок;
- изоляция данных PostgreSQL и Redis в серверной сети.

### Клиенты

- адаптивный веб-интерфейс;
- Electron-приложение для Windows 10/11, Windows ARM64 и macOS;
- сворачивание desktop-приложения в трей и масштабирование интерфейса;
- приложения на Capacitor для Android и iOS;
- автоматические сборки клиентов через GitHub Actions.

## Технологии

| Часть | Стек |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic |
| База данных | PostgreSQL 16 |
| События и кэш | Redis |
| Frontend | React 19, TypeScript, Next.js/Vinext, TanStack Query |
| E2EE | Matrix SDK Crypto WASM |
| Звонки | WebRTC, WebSocket, coturn |
| Расшифровка голоса | faster-whisper |
| Desktop | Electron, electron-builder |
| Mobile | Capacitor, WKWebView, Android WebView |
| Инфраструктура | Docker Compose, Nginx, GitHub Actions |

## Структура репозитория

```text
ChatWave/
├── src/                    # FastAPI API, модели, сервисы и миграции
├── frontend/               # Веб-клиент
├── desktop/                # Electron-клиент Windows/macOS
├── mobile/
│   ├── android/            # Android-проект
│   └── ios/                # Xcode-проект
├── tests/                  # API- и unit-тесты
├── nginx/                  # Конфигурация reverse proxy
├── docs/                   # Техническая документация
└── docker-compose.yml      # Локальная инфраструктура
```

## Быстрый запуск через Docker

### Требования

- Docker Engine с Docker Compose;
- свободные порты `8000` и `8091`;
- минимум 2 ГБ оперативной памяти.

Скопируйте пример конфигурации:

```bash
cp .env.example .env
```

Замените все значения `CHANGE_ME`. Для локального запуска также задайте:

```dotenv
API_CORS_ALLOW_ORIGINS=["http://localhost:8091"]
FRONTEND_API_URL=http://localhost:8000
```

Секреты можно сгенерировать командой:

```bash
openssl rand -hex 48
```

Запустите базу данных, Redis, API и локальный frontend:

```bash
docker compose up --build -d postgres redis chatwave frontend
```

После запуска веб-интерфейс доступен на `http://localhost:8091`, API — на
`http://localhost:8000`.

Проверить состояние контейнеров:

```bash
docker compose ps
docker compose logs -f chatwave frontend
```

Остановить проект:

```bash
docker compose down
```

Для рабочего окружения обязательно используйте HTTPS, собственные стойкие
секреты и настроенный TURN-сервер. Не публикуйте PostgreSQL и Redis напрямую в
интернет.

## Запуск для разработки

### Backend

Для API необходимы запущенные PostgreSQL и Redis.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
MODE=development uvicorn main:app --app-dir src --reload --host 127.0.0.1 --port 8000
```

### Frontend

Требуется Node.js 22 или новее.

```bash
cd frontend
npm install
NEXT_PUBLIC_CHATWAVE_API_URL=http://localhost:8000 npm run dev
```

### Тесты

Frontend:

```bash
cd frontend
npm test
npm run test:mobile-layout
```

Backend-тесты используют отдельную тестовую схему PostgreSQL:

```bash
MODE=testing .venv/bin/pytest -q
```

## Desktop

### Локальный запуск

```bash
cd desktop
npm install
npm start
```

Для подключения к локальному frontend:

```bash
CHATWAVE_APP_URL=http://localhost:3000 npm start
```

### Сборка Windows

```bash
npm run build:win:x64
npm run build:win:arm64
```

### Сборка macOS

```bash
npm run build:mac -- --arm64
npm run build:mac -- --x64
```

Готовые файлы создаются в `desktop/release/`. Публичные сборки рекомендуется
подписать: Authenticode для Windows и Developer ID с notarization для macOS.

## Android и iOS

Установите зависимости:

```bash
cd mobile
npm install
```

Android:

```bash
npm run android:sync
npm run android:open
```

iOS:

```bash
npm run ios:sync
npm run ios:open
```

Android-проект открывается в Android Studio. Для iOS необходимы macOS, Xcode и
Apple Developer Team для установки на реальное устройство.

## E2EE

Криптографические операции выполняются на клиенте. Сервер хранит зашифрованное
содержимое и служебные данные, необходимые для синхронизации устройств.
Recovery key нужен для восстановления доступа к истории на новом устройстве.

E2EE не скрывает все метаданные: сервер по-прежнему обрабатывает аккаунты,
состав диалогов, время событий и доставку сообщений. Актуальная схема и модель
угроз описаны в `docs/E2EE_ARCHITECTURE.md`.

## Конфигурация

Основные переменные находятся в `.env.example`:

- `DB_*` — подключение к PostgreSQL;
- `REDIS_*` — подключение к Redis;
- `JWT_SECRET_KEY` — ключ подписи токенов, не короче 64 символов;
- `API_CORS_ALLOW_ORIGINS` — разрешённые адреса frontend;
- `MEDIA_FOLDER` — хранилище загруженных файлов;
- `STUN_URLS`, `TURN_URLS`, `TURN_SHARED_SECRET` — связь WebRTC;
- `MAX_UPLOAD_*` — ограничения размера файлов;
- `RATE_LIMIT_*` — ограничения частоты запросов;
- `REFRESH_SESSION_EXPIRES_SECONDS` — срок жизни пользовательской сессии.


## Лицензия

Проект распространяется на условиях GNU General Public License v3.0. Полный
текст находится в файле `LICENSE`.
