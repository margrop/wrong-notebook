# Deployment and Upgrades

The official image is `ghcr.io/margrop/wrong-notebook`, built for `linux/amd64` and `linux/arm64`. The upstream `ghcr.io/wttwins/wrong-notebook` image does not include the features added in this repository.

## Choose an image tag

| Tag | Use |
| --- | --- |
| An exact version such as `2026.10.20` | Pinned version, easy to upgrade and roll back |
| A month tag such as `2026.10` | Follows the stable releases of that month |
| `latest` | Follows the latest stable release |

See [Releases](https://github.com/margrop/wrong-notebook/releases) for available versions and release notes. The examples below use the published `2026.10.20`; replace it with the stable version you need.

## Deploy with Docker Compose

Create a deployment directory:

```bash
mkdir -p wrong-notebook/data wrong-notebook/config
cd wrong-notebook
openssl rand -base64 32
```

Write the generated secret and the actual access URL to `.env` in this directory:

```dotenv
NEXTAUTH_SECRET=replace-with-the-generated-secret
NEXTAUTH_URL=http://localhost:3000
```

When the app is accessed from other devices, set `NEXTAUTH_URL` to the full URL actually used to open it.

Create `docker-compose.yml`:

```yaml
services:
  wrong-notebook:
    image: ghcr.io/margrop/wrong-notebook:2026.10.20
    container_name: wrong-notebook
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?Set NEXTAUTH_SECRET in .env}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-http://localhost:3000}
      PRESERVE_EXISTING_DATA: "true"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
```

Start and check the service:

```bash
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/api/health
```

A healthy endpoint returns `status: "ok"` together with `version` and `revision`. It queries the database but does not test the AI; sign in, test the connection in the AI settings, and recognize a real question as well.

For the default account of a fresh install, see [Quick Start](Quick-Start-en).

## Persistent directories

| Container directory | Contents | Handling |
| --- | --- | --- |
| `/app/data` | SQLite database and initialization marker | Mount persistently and back up regularly |
| `/app/config` | AI configuration, prompts and global settings saved from the web UI | Mount persistently; backups contain sensitive credentials |
| `/app/certs` | Certificates for the built-in HTTPS | Mount and back up when used |

The image sets `PRESERVE_EXISTING_DATA=true` by default. When an existing database is found, startup runs the formal migrations and skips admin seeding and system tag rebuilding, so existing accounts, tags and their links are kept.

## HTTPS and reverse proxies

For access by domain name, use an HTTPS certificate trusted by browsers. A reverse proxy can forward HTTPS requests to the app's HTTP port; set `NEXTAUTH_URL` to the external HTTPS address.

The app also provides built-in HTTPS; see [`docker-compose.https.yml`](https://github.com/margrop/wrong-notebook/blob/main/docker-compose.https.yml) in the repository:

- Set `HTTPS_ENABLED=true`, `CERT_DOMAIN` and the correct `NEXTAUTH_URL`.
- Map container port `443` and mount the certificate directory at `/app/certs`.
- Custom certificates must be named `cert.pem` and `key.pem`; if they are missing, the startup script tries to generate a self-signed certificate.

Clients must be set up to trust a self-signed certificate. HTTPS is one of the requirements for screenshots, and mobile browsers may still not support `getDisplayMedia()`. See the [HTTPS setup guide](https://github.com/margrop/wrong-notebook/blob/main/doc/HTTPS_SETUP.md) for details.

## Upgrade

1. Note the current image version and back up `data/`, `config/` and the deployment configuration following the [full-site backup steps](Backup-and-Restore-en).
2. Change the image version in Compose, keeping the mounted directories and the session secret.
3. Run:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose logs --tail=100 wrong-notebook
   curl --fail http://localhost:3000/api/health
   ```

4. Check the running version, then sign in and confirm that existing accounts, questions, tags and exam papers still work.

To roll back after an upgrade, stop the service, restore the data and configuration that match the old version from your backup, then start the old image. Once the database has been migrated, switching back to the old image alone may not be compatible.

## Build the image from source

```bash
git clone https://github.com/margrop/wrong-notebook.git
cd wrong-notebook
docker build -t wrong-notebook:local .
```

The Dockerfile runs Vitest, script syntax checks and the production build inside the image, and initializes the database used by fresh installs. Change `image` in Compose to `wrong-notebook:local` and run it with the same mounts as above.

## Installers (without Docker)

Every release on [Releases](https://github.com/margrop/wrong-notebook/releases) also ships the installers below. They run the same server as the image and also apply database migrations on startup while keeping existing data:

| Platform | Installation | Default data directory |
| --- | --- | --- |
| npm | `npm install -g wrong-notebook`, then run `wrong-notebook --port 3000` (requires Node.js 22.15 or later) | `~/.wrong-notebook` |
| Windows | `WrongNotebook-Win-Setup-<version>-x64.exe` or the install-free `Portable` build | `%APPDATA%\WrongNotebook\data` |
| macOS | `WrongNotebook-Mac-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel) | `~/Library/Application Support/WrongNotebook/data` |
| Linux | `WrongNotebook-Linux-<version>-<arch>.AppImage` or `.deb` | `~/.config/WrongNotebook/data` |
| fnOS | Install Node.js v24 from the app center first, then install `WrongNotebook-FnOS-<version>-x86.fpk` or `-arm.fpk` manually | App data directory `@appdata/wrongnotebook` |
| Android phone / tablet (standalone) | Install `WrongNotebook-Android-Phone-<version>.apk` or `WrongNotebook-Android-Tablet-<version>.apk` | App-private directory, removed on uninstall |
| Android phone / tablet (client) | Install `WrongNotebook-Android-Client-Phone-<version>.apk` or `-Client-Tablet-<version>.apk` and enter the server address on first launch | Stores no data; connects to a deployed server |

Desktop builds listen only on the local machine, on port 39300 by default; the fnOS build listens on port 39300 and is reachable on the LAN. The database, AI configuration and session secret all live in the data directory, so back up the whole directory.

Desktop installers are unsigned. If macOS says the app is damaged or cannot be opened, first move it to Applications, then run these commands in Terminal to remove the quarantine flag and re-sign it locally before opening it:

```bash
xattr -cr /Applications/WrongNotebook.app
codesign --force --deep --sign - /Applications/WrongNotebook.app
```

The Android standalone edition runs the server on the phone with no separate deployment and needs a 64-bit ARM device on Android 8.0 or later; the Android client edition is only a shell that connects to a server, which must first be deployed with one of the methods above. See [INSTALL_PACKAGES.md](https://github.com/margrop/wrong-notebook/blob/main/doc/INSTALL_PACKAGES.md) for details.
