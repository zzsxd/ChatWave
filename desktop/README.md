# ChatWave Desktop

Windows 10/11 and macOS desktop client built with Electron.

## Development

```bash
npm install
npm start
```

The client loads the production ChatWave web application. Override it for
development with `CHATWAVE_APP_URL=http://localhost:3001`.

## Windows installer

```bash
npm run build:win
npm run build:win:arm64
```

The NSIS installer is written to `desktop/release/`. Production installers
should be Authenticode-signed before distribution to avoid SmartScreen
warnings. Use the `x64` build for regular Intel/AMD computers and `arm64` for
Windows on ARM devices.

## macOS application

```bash
npm run build:mac -- --arm64
npm run build:mac -- --x64
```

DMG and ZIP files are written to `desktop/release/`. Apple Silicon uses
`arm64`; Intel Macs use `x64`. Distribution builds should be signed with a
Developer ID certificate and notarized by Apple. Camera, microphone, and
screen-recording access are requested by macOS on first use.
