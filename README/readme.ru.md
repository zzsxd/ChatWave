

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
- 🧹 Полное удаление сообщений

## 🛣️ Планы

- 🌐 Web веб-фронтенд (уже доступен, но всё еще в активной разработке: [chatwave-web](https://github.com/lifufkd/chatwave-web))
- 🎥 Поддержка видео-сообщений
- 📞 Голосовые и видео-звонки

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
 
# Optionaly
DB_DATABASE=<DATABASE-NAME>
DB_PORT=<PORT>
DB_SCHEMA=chatwave
REDIS_PORT=<PORT>
REDIS_DATABASE=0
REDIS_USER=<USER>
REDIS_PASSWORD=<PASSWORD>
JWT_SECRET_KEY=09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7 # 256 bit random string
JWT_ACCESS_TOKEN_EXPIRES=1209600 # Token expire time in seconds
JWT_ALGORITHM=HS256
CHUNK_SIZE=16 # Decimal value in MB for streaming video
MAX_UPLOAD_IMAGE_SIZE=30 # Decimal value in MB
MAX_UPLOAD_VIDEO_SIZE=8192 # Decimal value in MB
MAX_UPLOAD_AUDIO_SIZE=512 # Decimal value in MB
MAX_UPLOAD_FILE_SIZE=16384 # Decimal value in MB
MAX_ITEMS_PER_REQUEST=100 # Decimal value
```

## ❤️ Поддержка

Поддержите проект тестированием, созданием issue, или отправкой pull request.
Также посмотрите фронтенд-часть: [ChatWave Web](https://github.com/lifufkd/chatwave-web)

## 📜 Лицензия

Распространяется по лицензии GPLv3. Подробнее — в [LICENSE](https://github.com/lifufkd/ChatWave/blob/main/LICENSE).
