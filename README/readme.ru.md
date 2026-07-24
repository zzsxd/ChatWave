

<!-- Переключатель языка -->
[🇷🇺 Русский](readme.ru.md) | [🇬🇧 English](../README.md)

<p align="center">
  <img src="../assets/logo-dark.svg" alt="ChatWave logo" width="200"/>
</p>

<p align="center">
  🔗 <a href="http://144.21.36.114/authorization/signin.html" target="_blank"><strong>Попробуйте демо версию!</strong></a>  
  <br/>
  <code>Логин:</code> <strong>demo</strong> &nbsp;•&nbsp; <code>Пароль:</code> <strong>Demodemo123</strong>
</p>

# 💬 ChatWave

**ChatWave** — это REST API мессенджера с открытым исходным кодом и лицензией **GPLv3**. Репозиторий содержит только **backend**, написанный на **Python 3.11** с использованием **FastAPI**.

## ✨ Возможности

- 🏠 Самостоятельный хостинг
- 🔐 Безопасная авторизация (JWT Bearer HS256), TLSv3, хеширование паролей
- 👤 Управление аккаунтом и профилем
- 💬 Личные и групповые чаты
- 🎙️ Поддержка медиа-сообщений (голос, изображения, файлы)
- ⚡ Мгновенное получение сообщений через WebSocket
- 📞 Аудио- и видеозвонки WebRTC один на один
- 🧹 Полное удаление сообщений

## 🛣️ Планы

- 🌐 Web веб-фронтенд (уже доступен, но всё еще в активной разработке: [chatwave-web](https://github.com/lifufkd/chatwave-web))
- 🎥 Поддержка видео-сообщений
- 📞 Групповые аудио- и видеозвонки

## 🚀 Как начать

### 🧑‍💻 1. Запуск из исходников

#### 1. Скачайте docker образ:

```
docker pull ghcr.io/lifufkd/chatwave:latest
```

#### 2. Запустите с необходимыми переменными окружения:

```bash
docker run \
--name chatwave \
-d \
-p 8080:8000 \
-v <PATH_TO_MEDIA_FOLDER>:/app/data \
--env-file <PATH-TO-ENV> \
ghcr.io/lifufkd/chatwave:latest
```

### 🐳 2. Запуск в докер

### 1. Docker
```bash
docker run \
--name chatwave \
-d \
-p 8080:8000 \
-v <PATH_TO_MEDIA_FOLDER>:/app/data \
--env-file <PATH-TO-ENV> \
ghcr.io/lifufkd/chatwave:latest
```
### 2. Docker-compose

#### 1. HTTP (no ssl)
```bash
git clone https://github.com/lifufkd/ChatWave
cd ChatWave
docker-compose up -d
```

Для безопасности этот вариант по умолчанию публикует API только на
`127.0.0.1`. Используйте его за локальным reverse proxy. Указывайте
`API_BIND_ADDRESS=0.0.0.0` только в доверенной сети: логины и сообщения нельзя
передавать через публичный HTTP без TLS.


#### 2. HTTPS (ssl)
```bash
git clone https://github.com/lifufkd/ChatWave
cd ChatWave
docker-compose -f docker-compose.nginx.yml up -d
```

## ⚙️ Конфигурация .env

```
# Required
MEDIA_FOLDER=<PATH> # Must be same in run command (-v chatwave_appdata:/app/data)

# Required for "Standalone" installation method
DB_HOST=<DOMAIN-OR-IP>
DB_USER=<USER>
DB_PASSWORD=<PASSWORD>
REDIS_HOST=<DOMAIN-OR-IP>

# Required for HTTPS (ssl)
SSL_CERTS_FOLDER=<PATH_TO_FOLDER_WITH_CERTS>
SSL_CERT_PATH=/cert/cert.pem
SSL_CERT_KEY=/cert/cert.key
 
# Обязательно в production
REDIS_PASSWORD=<PASSWORD>
JWT_SECRET_KEY=<СЛУЧАЙНАЯ-СТРОКА-НЕ-КОРОЧЕ-64-СИМВОЛОВ>
API_CORS_ALLOW_ORIGINS=["https://chat.example.com"]

# Опционально
DB_DATABASE=<DATABASE-NAME>
DB_PORT=<PORT>
DB_SCHEMA=chatwave
REDIS_PORT=<PORT>
REDIS_DATABASE=0
REDIS_USER=<USER>
JWT_ACCESS_TOKEN_EXPIRES=900 # Время жизни access-токена в секундах
JWT_ALGORITHM=HS256
CHUNK_SIZE=16 # Decimal value in MB for streaming video
MAX_UPLOAD_IMAGE_SIZE=20 # Decimal value in MB
MAX_UPLOAD_VIDEO_SIZE=256 # Decimal value in MB
MAX_UPLOAD_AUDIO_SIZE=64 # Decimal value in MB
MAX_UPLOAD_FILE_SIZE=128 # Decimal value in MB
MAX_REQUEST_BODY_SIZE_MB=260 # Включая multipart overhead
MAX_ITEMS_PER_REQUEST=100 # Decimal value
RATE_LIMIT_REQUESTS_PER_MINUTE=300
RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_SIGNUP_PER_HOUR=5
MAX_WEBSOCKETS_PER_USER=5
```

Перед запуском обновлённого приложения выполните `alembic upgrade head`.
WebSocket-клиенты должны передавать subprotocols
`["bearer", "<access-token>"]`; токены в query string больше не принимаются.
Compose-файлы используют PostgreSQL 16. Существующий volume PostgreSQL 13
нужно перенести штатным dump/restore или `pg_upgrade` до смены образа.

Перед запуском обновлённой версии существующая установка должна выполнить
`alembic upgrade head`. WebSocket-клиенты передают авторизацию через
подпротоколы `["bearer", "<access-token>"]`; токены в query string больше не
принимаются.

Личные аудио- и видеозвонки используют защищённый сигнальный WebSocket
`/calls/ws` и браузерный WebRTC. Во фронтенде укажите
`NEXT_PUBLIC_CHATWAVE_API_URL`. Для стабильной работы через мобильные сети,
корпоративные firewall и сложный NAT также задайте
`NEXT_PUBLIC_CHATWAVE_ICE_SERVERS` — JSON-массив с вашими STUN и
авторизованными TURN-серверами. Одного публичного STUN для production
недостаточно.

## ❤️ Поддержка

Поддержите проект тестированием, созданием issue, или отправкой pull request.
Также посмотрите фронтенд-часть: [ChatWave Web](https://github.com/lifufkd/chatwave-web)

## 📜 Лицензия

Распространяется по лицензии GPLv3. Подробнее — в [LICENSE](https://github.com/lifufkd/ChatWave/blob/main/LICENSE).
