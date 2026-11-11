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

To send no anonymous statistics at all (restricted networks or demo sites), add `TELEMETRY_DISABLED=true` to `.env`; it forces local recording, error reporting and forwarding off. Otherwise adjust them under "Settings → User Management → Privacy & telemetry"; see [Settings and Users](Settings-and-Users-en#privacy-and-telemetry).

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

A fresh deployment has no default account; the startup log prints a one-time setup link:

```bash
docker compose logs wrong-notebook | grep initialize
```

Open the link in a browser (its host matches `NEXTAUTH_URL`), choose the admin email and password, and continue in the setup wizard. The link works only once; the token is also stored in `config/setup-token`.

A healthy endpoint returns `status: "ok"` together with `version` and `revision`. It queries the database but does not test the AI; sign in, test the connection in the AI settings, and recognize a real question as well.

For the default account of a fresh install, see [Quick Start](Quick-Start-en).

## Unraid (Docker UI)

Unraid manages containers from its Docker page, so no `docker-compose.yml` is needed. The app data directory defaults to `/mnt/user/appdata/wrong-notebook`.

On the Docker page click **Add Container**, switch to the advanced view, and fill in:

| Field | Value |
| --- | --- |
| Repository | `ghcr.io/margrop/wrong-notebook:<exact-version>` (recommended, e.g. `2026.11.6`) or `latest` |
| Network | bridge |
| Port | host port (e.g. `3000`) → container `3000` |
| Path 1 (host → container) | `/mnt/user/appdata/wrong-notebook/data` → `/app/data` |
| Path 2 (host → container) | `/mnt/user/appdata/wrong-notebook/config` → `/app/config` |
| Variable 1 | `NEXTAUTH_SECRET` = the output of `openssl rand -base64 32` |
| Variable 2 | `NEXTAUTH_URL` = `http://your-ip-or-domain:3000` |
| Variable 3 | `PRESERVE_EXISTING_DATA` = `true` |
| Restart policy | `unless-stopped` |

Unraid creates the host directories if they do not exist. Click **Apply** to start, then check:

```bash
docker logs wrong-notebook 2>&1 | grep initialize
curl --fail http://localhost:3000/api/health
```

A fresh start has no default account: open the one-time setup link from the log (the token is also in `/mnt/user/appdata/wrong-notebook/config/setup-token`), set the admin email and password, and continue in the setup wizard. The host in `NEXTAUTH_URL` must match the actual address used to open the app.

### Upgrade

1. Note the current Repository tag, then stop the container and archive the whole appdata directory following [Backup and Restore](Backup-and-Restore-en); you can also add this directory to Unraid's Appdata Backup plugin.
2. Edit the container on the Docker page:
   - With `latest`: click **Force update** to pull and recreate.
   - With an exact version: change the Repository tag to the new version, then click **Apply** (or **Force update**).
3. Keep the `data` and `config` mappings and `NEXTAUTH_SECRET` unchanged; startup applies database migrations and keeps existing accounts, tags, questions and exam papers.
4. Check the container log and `/api/health`, then sign in and verify the running version and data.

**Rollback**: stop the container, restore the pre-upgrade `data/` and `config/`, change the Repository tag back to the old version, and start it. Once the database has been migrated, switching back to the old image alone may not be compatible.

## Synology DSM (Container Manager)

DSM 7.2 or later uses Container Manager; the older Docker package works similarly. The suggested data directory is `/volume1/docker/wrong-notebook`; replace the path if your storage volume differs.

**Package install (recommended)**: install Container Manager first, then choose `WrongNotebook-Synology-<version>-x86_64.spk` (Intel / AMD models) or `-arm64.spk` (64-bit ARM models) under Package Center → **Manual Install**. DSM 7.2.1 or later is required. The package creates the `wrong-notebook` project in Container Manager, loads the bundled image of the same version (no image download during installation), maps host port `39300` to container `3000`, and stores data in the package data directory `/volumeN/@appdata/wrongnotebook`; open the app from the **Wrong Notebook** icon in the DSM main menu or at `http://<NAS address>:39300`, and the first start shows the admin setup page. Upgrading the package recreates the container from the new image and keeps data; uninstalling keeps the data directory.

Manual container method:

1. **Prepare directories**: create `docker/wrong-notebook/data` and `config` in File Station, or run over SSH:

   ```bash
   mkdir -p /volume1/docker/wrong-notebook/data /volume1/docker/wrong-notebook/config
   ```

2. **Pull the image**: Container Manager → **Image** → Add, search the registry for `margrop/wrong-notebook`, or add `ghcr.io/margrop/wrong-notebook:<exact-version>` (e.g. `2026.11.6`) by URL.
3. **Create the container**: **Container** → Add → Create from image, then select the image:

   | Field | Value |
   | --- | --- |
   | Container name | `wrong-notebook` |
   | Port | local `3000` → container `3000` |
   | Volume 1 | `/volume1/docker/wrong-notebook/data` → `/app/data` (read/write) |
   | Volume 2 | `/volume1/docker/wrong-notebook/config` → `/app/config` (read/write) |
   | Environment variables | `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://your-ip-or-domain:3000`, `PRESERVE_EXISTING_DATA=true` |
   | Auto restart | enabled |

4. **Start and initialize**: after starting, find the `initialize` link under the container details → log (the token is also in `/volume1/docker/wrong-notebook/config/setup-token`), then set the admin email and password. Check `curl --fail http://localhost:3000/api/health`; a healthy response returns `status: "ok"`, `version` and `revision`.
5. **Upgrade**: stop the container and archive the whole directory following [Backup and Restore](Backup-and-Restore-en), or add `/volume1/docker/wrong-notebook` to a Hyper Backup task. Pull the new image tag, stop the old container, and recreate it from the new image with the same volumes, port and environment variables. Startup applies database migrations and keeps existing accounts, tags, questions and exam papers. With `latest`, pull the latest image and recreate.
6. **Rollback**: once the database has been migrated, switching back to the old image alone may not be compatible. Stop the container, restore the pre-upgrade `data/` and `config/`, then recreate from the old image.

For access by domain name, configure a reverse proxy under DSM **Control Panel → Login Portal → Advanced → Reverse Proxy**, forward HTTPS to the container port, and set `NEXTAUTH_URL` to the external address.

## QNAP QTS (Container Station)

Use Container Station. The suggested data directory is `/share/Container/wrong-notebook`; Container Station's default shared folder is `Container`, so replace the path if you store data elsewhere.

**Package install (recommended)**: install Container Station first, then choose `WrongNotebook-QNAP-<version>-x86_64.qpkg` (Intel / AMD models) or `-arm64.qpkg` (64-bit ARM models) under App Center → **Manual Install**. The package loads the bundled image of the same version (no image download needed), generates `NEXTAUTH_SECRET`, maps host port `39300` to container `3000`, and stores data at `/share/Container/wrong-notebook/{data,config}`; the App Center open link opens the app, and the first start shows the admin setup page. Upgrading the package recreates the container from the new image and keeps data; uninstalling keeps the data directory.

Manual container method:

1. **Prepare directories**: create them in File Station, or run over SSH:

   ```bash
   mkdir -p /share/Container/wrong-notebook/data /share/Container/wrong-notebook/config
   ```

2. **Pull the image**: pull `ghcr.io/margrop/wrong-notebook:<exact-version>` on Container Station's image page; you can also run `docker pull ghcr.io/margrop/wrong-notebook:<exact-version>` over SSH. With an **Application** (Compose), specify the image directly in the YAML `image` field.
3. **Create the container**: **Container** → Create, then select the pulled image:

   | Field | Value |
   | --- | --- |
   | Container name | `wrong-notebook` |
   | Port | host `3000` → container `3000` |
   | Volume 1 | `/share/Container/wrong-notebook/data` → `/app/data` |
   | Volume 2 | `/share/Container/wrong-notebook/config` → `/app/config` |
   | Environment variables | `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://your-ip-or-domain:3000`, `PRESERVE_EXISTING_DATA=true` |
   | Restart policy | `unless-stopped` |

4. **Start and initialize**: after starting, find the `initialize` link in the container log (the token is also in `/share/Container/wrong-notebook/config/setup-token`), then set the admin email and password. Check `curl --fail http://localhost:3000/api/health`.
5. **Upgrade**: stop the container and archive the data directory following [Backup and Restore](Backup-and-Restore-en), or add `/share/Container/wrong-notebook` to a Hybrid Backup Sync task. Pull the new image, then recreate the container with the same volumes, port and environment variables; with an **Application**, change the image tag in the YAML and re-apply. Startup applies database migrations automatically.
6. **Rollback**: once the database has been migrated, switching back to the old image alone may not be compatible. Stop the container, restore the pre-upgrade `data/` and `config/`, then recreate from the old image.



## Persistent directories

| Container directory | Contents | Handling |
| --- | --- | --- |
| `/app/data` | SQLite database and initialization marker | Mount persistently and back up regularly |
| `/app/config` | AI configuration, prompts and global settings saved from the web UI | Mount persistently; backups contain sensitive credentials |
| `/app/certs` | Certificates for the built-in HTTPS | Mount and back up when used |

The image sets `PRESERVE_EXISTING_DATA=true` by default. When an existing database is found, startup runs the formal migrations and skips admin seeding and system tag rebuilding, so existing accounts, tags and their links are kept.

## HTTPS and reverse proxies

For access by domain name, use an HTTPS certificate trusted by browsers. A reverse proxy can forward HTTPS requests to the app's HTTP port; set `NEXTAUTH_URL` to the external HTTPS address.

The reverse proxy should forward `X-Real-IP` or `X-Forwarded-For`, because failed sign-ins are counted per client IP. The app sends security headers such as `X-Frame-Options: SAMEORIGIN` by default, so pages on other domains cannot embed it in an iframe; configure HSTS on the reverse proxy if you need it.

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
| fnOS | Install Node.js v24 from the app center first, then install `WrongNotebook-FnOS-<version>-x86.fpk` or `-arm.fpk` manually and set the admin email and password in the install wizard | App data directory `@appdata/wrongnotebook` |
| Android phone / tablet (standalone) | Install `WrongNotebook-Android-Phone-<version>.apk` or `WrongNotebook-Android-Tablet-<version>.apk` | App-private directory, removed on uninstall |
| Android phone / tablet (client) | Install `WrongNotebook-Android-Client-Phone-<version>.apk` or `-Client-Tablet-<version>.apk` and enter the server address on first launch | Stores no data; connects to a deployed server |

Windows installers are currently unsigned. The project has been accepted by SignPath Foundation and is testing the integration with a test certificate; signing will be enabled once the production certificate is issued. See the [Code signing policy](https://github.com/margrop/wrong-notebook/blob/main/doc/CODE_SIGNING.en.md) for scope, responsibilities and status, and the [privacy policy](https://github.com/margrop/wrong-notebook/blob/main/doc/PRIVACY.en.md) for data processing. Maintainers can follow the [Windows signing setup guide](https://github.com/margrop/wrong-notebook/blob/main/doc/WINDOWS_SIGNING.md).

Desktop builds listen only on the local machine, on port 39300 by default; the fnOS build listens on port 39300 and is reachable on the LAN. The database, AI configuration and session secret all live in the data directory, so back up the whole directory.

Desktop installers do not yet carry a trusted signature: Windows installers are unsigned, and macOS packages are only ad-hoc signed and not notarized by Apple. If macOS blocks the first launch, move the app to Applications, then go to System Settings → Privacy & Security and click **Open Anyway**. If macOS still says the app is damaged (common with older packages), run these commands in Terminal to remove the quarantine flag and re-sign it locally before opening it:

```bash
xattr -cr /Applications/WrongNotebook.app
codesign --force --deep --sign - /Applications/WrongNotebook.app
```

The Android standalone edition runs the server on the phone with no separate deployment and needs a 64-bit ARM device on Android 8.0 or later; both Android editions need Android System WebView 111 or later; the Android client edition is only a shell that connects to a server, which must first be deployed with one of the methods above. See [INSTALL_PACKAGES.md](https://github.com/margrop/wrong-notebook/blob/main/doc/INSTALL_PACKAGES.md) for details.
