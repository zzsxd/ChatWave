<!-- Language switch -->
[🇷🇺 Русский](README/readme.ru.md) | [🇬🇧 English](README.md)

<p align="center">
  <img src="assets/logo-dark.svg" alt="ChatWave logo" width="200"/>
</p>

<p align="center">
  🔗 <a href="http://144.21.36.114/authorization/signin.html" target="_blank"><strong>Try the Live Demo</strong></a>  
  <br/>
  <code>Login:</code> <strong>demo</strong> &nbsp;•&nbsp; <code>Password:</code> <strong>Demodemo123</strong>
</p>


# 💬 ChatWave

**ChatWave** is a modern, simple, and secure REST API for a self-hosted messenger — open source and licensed under **GPLv3**.  
This repository contains only the **backend**, built with **Python 3.11** and **FastAPI**.

## ✨ Features

- 🏠 Self-hosted backend
- 🔐 Secure auth (JWT Bearer HS256), TLSv3, password hashing
- 👤 Account & profile management
- 💬 Personal & group chats
- 🎙️ Media messages (voice, images, files)
- ⚡ Real-time message updates via WebSocket
- 📞 WebRTC audio & video calls (1-on-1)
- 🧹 Permanent deletion of messages

## 🛣️ Roadmap

- 🌐 Web frontend (already available, but still in active development: [chatwave-web](https://github.com/lifufkd/chatwave-web))
- 🎥 Video messages (real-time)
- 📞 Group audio & video calls

## 🚀 Getting Started

### 🧑‍💻 1. Run from source

```bash
git clone https://github.com/lifufkd/ChatWave
pip install -r requirements.txt
cd ./src
nano .env (Fill in the env file according to the section "ENV configuration")
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 🐳 2. Run with Docker

### 1. Standalone 

#### 1. Download the docker image:

```
docker pull ghcr.io/lifufkd/chatwave:latest
```

#### 2. Run with the necessary environment variables:

```bash
docker run \
--name chatwave \
-d \
-p 8080:8000 \
-v <PATH_TO_MEDIA_FOLDER>:/app/data \
--env-file <PATH-TO-ENV> \
ghcr.io/lifufkd/chatwave:latest
```

### 2. All in one

#### 1. HTTP (no ssl)
```bash
git clone https://github.com/lifufkd/ChatWave
cd ChatWave
docker-compose up -d
```

For safety, this mode binds the API to `127.0.0.1` by default. Use it behind
a local reverse proxy. Set `API_BIND_ADDRESS=0.0.0.0` only on a trusted network;
credentials and messages must not be sent over public plain HTTP.


#### 2. HTTPS (ssl)
```bash
git clone https://github.com/lifufkd/ChatWave
cd ChatWave
docker-compose -f docker-compose.nginx.yml up -d
```

## ⚙️ ENV Configuration

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
 
# Required in production
REDIS_PASSWORD=<PASSWORD>
JWT_SECRET_KEY=<AT-LEAST-64-RANDOM-CHARACTERS>
API_CORS_ALLOW_ORIGINS=["https://chat.example.com"]

# Optional
DB_DATABASE=<DATABASE-NAME>
DB_PORT=<PORT>
DB_SCHEMA=chatwave
REDIS_PORT=<PORT>
REDIS_DATABASE=0
REDIS_USER=<USER>
JWT_ACCESS_TOKEN_EXPIRES=900 # Access token lifetime in seconds
JWT_ALGORITHM=HS256
CHUNK_SIZE=16 # Decimal value in MB for streaming video
MAX_UPLOAD_IMAGE_SIZE=20 # Decimal value in MB
MAX_UPLOAD_VIDEO_SIZE=256 # Decimal value in MB
MAX_UPLOAD_AUDIO_SIZE=64 # Decimal value in MB
MAX_UPLOAD_FILE_SIZE=128 # Decimal value in MB
MAX_REQUEST_BODY_SIZE_MB=260 # Includes multipart overhead
MAX_ITEMS_PER_REQUEST=100 # Decimal value
RATE_LIMIT_REQUESTS_PER_MINUTE=300
RATE_LIMIT_LOGIN_PER_MINUTE=10
RATE_LIMIT_SIGNUP_PER_HOUR=5
MAX_WEBSOCKETS_PER_USER=5
```

Existing deployments should run `alembic upgrade head` before starting the
updated application. WebSocket clients authenticate with subprotocols
`["bearer", "<access-token>"]`; tokens in query strings are no longer accepted.
The compose files now use PostgreSQL 16. Existing PostgreSQL 13 volumes require
a supported dump/restore or `pg_upgrade` procedure before changing the image.

One-to-one audio and video calls use the authenticated `/calls/ws` signaling
socket and browser WebRTC. Configure the frontend with
`NEXT_PUBLIC_CHATWAVE_API_URL`. For reliable production calls, also set
`NEXT_PUBLIC_CHATWAVE_ICE_SERVERS` to a JSON array containing your STUN and
authenticated TURN servers; public STUN alone cannot traverse every NAT or
firewall.

## ❤️ Contributing

You can help by testing, opening issues, or contributing code.
Also check out our frontend repo [ChatWave Web](https://github.com/lifufkd/chatwave-web)

## 📜 License
Distributed under the GPLv3 License. See [LICENSE](https://github.com/lifufkd/ChatWave/blob/main/LICENSE) for more information.
