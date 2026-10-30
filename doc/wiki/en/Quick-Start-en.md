# Quick Start

For regular deployments the [Docker image](Deployment-en) is recommended. Follow this page when you need to debug or change the source code.

## Requirements

- Node.js 22 or later (24 recommended), with npm.
- Git; Python 3 is also needed to run the full CI.
- Network access to your chosen AI service, plus its API credentials.

The database is SQLite by default, so no separate database server is needed.

## Get the code and install dependencies

```bash
git clone https://github.com/margrop/wrong-notebook.git
cd wrong-notebook
npm ci
cp .env.example .env
```

Edit `.env` and at least check the database path and session secret:

```dotenv
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="replace with a randomly generated secret"
NEXTAUTH_URL="http://localhost:3000"
```

Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`. `file:./dev.db` is relative to `prisma/schema.prisma`, i.e. `prisma/dev.db`.

AI credentials can be filled in later from the admin settings in the web UI; see [AI Configuration](AI-Configuration-en).

## Initialize a new database

These steps are for a freshly created development database:

```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts
```

The migration creates the tables, the seed script creates the admin account, and the last step builds the system knowledge-point library. To upgrade an existing production database, follow [Deployment and Upgrades](Deployment-en): back up first, then run the formal migrations.

## Start and sign in

```bash
npm run dev
```

A fresh database has no admin. When the server starts, the terminal prints a one-time setup link (the log message is in Chinese):

```text
尚未创建管理员。请打开以下初始化链接设置管理员账号（仅可使用一次）：http://localhost:3000/initialize?token=…
```

Open the link and choose the admin name, email and password (at least 6 characters, and not the old default password `123456`). After submitting you are signed in and taken to the setup wizard to set up an AI provider and create your first notebook; both steps can be skipped. The token is also stored in `config/setup-token` and is deleted once the admin exists; while there is no admin, restarting the server prints the link again. Run the wizard again from Settings → User Management; instances that already have notebooks do not open it automatically after upgrading.

Instances upgraded from earlier versions keep their accounts; signing in as the old default admin `admin@localhost` with the default password still requires changing it first.

## Add your first question

1. In the admin AI settings, pick a provider, fill in the parameters and test the connection.
2. Create a notebook and choose its school stage and subject; neither can be changed later.
3. Upload a question image or type the text, check the recognition result and save.
4. Check the answer, analysis, knowledge points and difficulty on the question page, then try similar-question practice.

![Photo upload, AI solve and direct entry](https://raw.githubusercontent.com/margrop/wrong-notebook/a5f816515e3dc31dcdb90c9fa456baed12eef94d/doc/screenshots/en/upload.png)

## Install on a phone home screen

- iPhone / iPad: open the app in Safari and choose "Share → Add to Home Screen".
- Android: in the Chrome menu choose "Add to Home screen" or "Install app". You can also install the Android app from [Releases](https://github.com/margrop/wrong-notebook/releases): the standalone edition bundles the server, so no deployment is needed — use `WrongNotebook-Android-Phone-<version>.apk` on phones and `WrongNotebook-Android-Tablet-<version>.apk` on tablets. If you already have a server, install the client edition `WrongNotebook-Android-Client-Phone/Tablet-<version>.apk` and enter the server address on first launch.

The PWA adds a home-screen entry and supports landscape on tablets. Over HTTPS it caches page scripts and icons and shows an offline page when the network is down; data itself is not cached offline. AI recognition and similar features still need the server and the AI service. Screenshots also depend on the browser supporting screen sharing in a secure context; see the [FAQ](FAQ-en).

For all environment variables, see [`.env.example`](https://github.com/margrop/wrong-notebook/blob/main/.env.example).
