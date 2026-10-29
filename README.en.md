<p align="center">
  <img src="public/icons/icon.png" width="128" height="128" alt="Smart Wrong Notebook app icon">
</p>

# Smart Wrong Notebook (智能错题本)

[简体中文](README.md) | **English**

[![GitHub downloads](https://img.shields.io/github/downloads/margrop/wrong-notebook/total?label=downloads&logo=github)](https://github.com/margrop/wrong-notebook/releases) [![npm downloads](https://img.shields.io/npm/d18m/wrong-notebook?label=npm%20downloads&logo=npm)](https://www.npmjs.com/package/wrong-notebook) [![GitHub stars](https://img.shields.io/github/stars/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/stargazers) [![GitHub forks](https://img.shields.io/github/forks/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/forks)

[![Desktop](https://img.shields.io/badge/Desktop-Windows%20%7C%20macOS%20%7C%20Linux-informational)](https://github.com/margrop/wrong-notebook/releases) [![Android](https://img.shields.io/badge/Android-34A853?logo=android&logoColor=white)](https://github.com/margrop/wrong-notebook/releases) [![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://github.com/margrop/wrong-notebook/pkgs/container/wrong-notebook) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/wrong-notebook) [![fnOS](https://img.shields.io/badge/fnOS-fpk-0A84FF)](https://github.com/margrop/wrong-notebook/releases) [![Web](https://img.shields.io/badge/Web-PC%20%7C%20Mobile-orange)](https://wrong-notebook-demo.vercel.app)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/margrop/wrong-notebook?include_prereleases)](https://github.com/margrop/wrong-notebook/releases) [![CI](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml) [![CodeQL](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml) [![npm](https://img.shields.io/npm/v/wrong-notebook)](https://www.npmjs.com/package/wrong-notebook)

An AI-powered notebook for the questions you got wrong. Snap a photo or type a question, and AI recognizes it, solves it, tags it with knowledge points and rates its difficulty. Manage your notebooks, practice with similar questions, build printable exams and track how well you have mastered each question.

⬇️ **Download**: <https://blog.margrop.net/wrong-notebook-github-pages/en/download/> (detects your OS and architecture, and lists every installer for Windows, macOS, Linux, Android and fnOS)

🌐 **Project website**: <https://blog.margrop.net/wrong-notebook-github-pages/en/>

📝 **Articles**: [Stop Copying Mistakes. Start Learning from Them](https://blog.margrop.net/en/post/wrong-notebook-ai-family-learning/) · [Free MiniMax Accounts, fnOS, and Daily Review](https://blog.margrop.net/en/post/wrong-notebook-minimax-free-ai-review/)

🚀 **Live demo**: <https://wrong-notebook-demo.vercel.app> (account `demo@localhost`, password `demo123456`)

> The demo uses a shared account and its data is visible to every visitor. Do not enter personal information.

📦 **Install anywhere**: Docker image (amd64 / arm64) · npm (`npm i -g wrong-notebook`) · Windows · macOS · Linux · fnOS · Android phone / tablet (standalone with a built-in server, or a client for your server). Get the installers from [Releases](https://github.com/margrop/wrong-notebook/releases); see [Quick Start](#-quick-start) for instructions.

🆓 **Works with a free MiniMax account**: choose the "MiniMax Code OAuth" channel and sign in with a MiniMax Code account in the browser to use `MiniMax-M3.1-Flash` without buying an API key. The app checks in every day to collect credits, and AI features such as recognition and explanations use the account's free credits. See [MiniMax Code OAuth](#minimax-code-oauth).

> This repository is a fork of [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) with many additional features (listed below).

> The app's built-in knowledge-point library follows the Chinese K-12 curriculum (primary, junior high and senior high school). The interface is available in Simplified Chinese and English.

## 💬 Community

To ask questions, share how you use the app or suggest ideas, join the QQ group **964325781** (conversations are mainly in Chinese), or scan the QR code below with QQ. Please still report bugs and feature requests in [Issues](https://github.com/margrop/wrong-notebook/issues) so they can be tracked. Before posting screenshots, hide your child's name, school, account details and server addresses.

<img src="doc/images/qq-group.webp" alt="QR code for the wrong-notebook QQ user group, group number 964325781" width="240">

## ⭐ Star History

<a href="https://www.star-history.com/#margrop/wrong-notebook&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date&amp;theme=dark">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date">
    <img src="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date" alt="GitHub star history chart for margrop/wrong-notebook">
  </picture>
</a>

## 🖼️ Screenshots

The screenshots below were captured from the running app on 2026-10-22 using English demo questions, answers, explanations, knowledge points and exams. The Student account and practice records are sample data. Click an image to view it full size.

**Notebook**: see each question's summary, difficulty stars and knowledge points on one page. Filter by grade, term, mastery and A/B paper, open a question by its ID, compare similarity or print in bulk.

The list loads card data only. Original images, answers and explanations load in question details or print preview, reducing data transfer when paging.

![English math questions with difficulty stars, English knowledge-point tags and filters](doc/screenshots/en/notebook.png)

<details>
<summary><strong>Input and preferences: photo upload, text input, review before import and configurable duplicate detection</strong></summary>

The home page offers photo upload, manual input and direct entry, with drag-and-drop and clipboard paste.

![Photo upload, manual input, direct entry, clipboard paste and screenshot on the home page](doc/screenshots/en/upload.png)

General settings control review before import, SVG animated explanations, GeoGebra demos, the similarity threshold for duplicate detection and the mastered threshold.

![Review before import, animated explanations, GeoGebra and duplicate threshold in General settings](doc/screenshots/en/preferences.png)

</details>

<details>
<summary><strong>Question details: formulas, difficulty stars, knowledge points and paper info</strong></summary>

Each question shows its text, knowledge points, grade, term and paper level. You can check the original photo and start practicing similar questions from here.

![An English linear-equation question with formulas, difficulty stars, knowledge points, grade and term](doc/screenshots/en/question-detail.png)

</details>

<details>
<summary><strong>SVG animated explanations: step-by-step animations of the solution</strong></summary>

An English animated explanation of a hexagon coloring problem, showing region relationships and the recursive counting. The player supports pause, seeking, replay and full screen.

![English SVG explanation of a hexagon coloring problem with an English counting table and player controls](doc/screenshots/en/svg-animation.png)

</details>

<details>
<summary><strong>Review feedback: similar questions, answer history and AI mastery estimate</strong></summary>

Results from practice questions and exams are collected under the original question; expand a record to see the variant question and its answer. AI estimates your mastery from the actual answer history to help plan the next review.

![An English exam variant, sample wrong-then-right answer history and a mastery estimate](doc/screenshots/en/mastery-history.png)

</details>

<details>
<summary><strong>Exams and printing: generate exams from your mistakes and record results per question</strong></summary>

Generated exams keep each source question's ID and show every attempt, so you can trace the effect back to the original question.

![An English demo exam with source IDs and sample results from multiple attempts](doc/screenshots/en/exam.png)

The print preview can include an answer page; download it as HTML, print it, or save it as PDF from the browser.

![An English exam print preview with source IDs, answer page toggle and export options](doc/screenshots/en/exam-print.png)

</details>

<details>
<summary><strong>Knowledge library: browse by subject, grade and chapter</strong></summary>

The tag library organizes knowledge points by curriculum level. Knowledge points now live under the **Stats** section: the "Knowledge Points" tab browses the standard library and manages custom tags, and the "Knowledge Point Stats" tab shows usage frequency. This demo uses English sample tags for algebra and geometry.

![English grade 4 tags expanded to show linear equations, adding fractions, angles, and area and perimeter](doc/screenshots/en/knowledge-tags.png)

</details>

<details>
<summary><strong>Statistics: mistake distribution, mastery rate, practice accuracy and trends</strong></summary>

Mistake statistics show total mistakes, mastered count, mastery rate, subject distribution and monthly trend.

![Mistake count, mastery rate, subject distribution and monthly trend charts](doc/screenshots/en/error-stats.png)

Practice statistics show total practice, accuracy and active months, with distribution and trends by subject and difficulty.

![Practice count, accuracy, active months and practice trend charts](doc/screenshots/en/practice-stats.png)

</details>

## ✨ Features

### Input and recognition

- **📷 Many ways to add questions**: upload images, paste from the clipboard (Ctrl/⌘+V), take a screenshot, or type the question (Markdown and LaTeX supported). Crop images (zoom with the mouse wheel, a pinch or the zoom buttons for precise selection), or select several questions on one image to import them in a batch.
- **🤖 AI recognition and solving**: AI extracts the question text, answer, analysis, the student's wrong answer and the cause of the mistake, identifies the subject and picks tags from the knowledge library. Turn on "Review before importing" in **Settings → General** to check and edit results before saving.
- **🔁 Duplicate detection**: on import, question text is compared by similarity. Above the threshold (90% by default, adjustable in settings) the question is not imported again; a new wrong attempt is recorded on the original instead.
- **🆔 Question ID**: every question has a 6-digit ID you can copy or type into the notebook to open it directly. Printed questions and exams show the source ID so you can find the original when entering results.

### Question content

- **∑ LaTeX formulas**: formulas in questions, answers and analyses are rendered with KaTeX, supporting `$…$`, `$$…$$`, `\(…\)` and `\[…\]`; switch between source and preview while editing. When a formula has syntax errors, a **Fix LaTeX** button appears and AI fixes only the formula syntax.
- **📝 Regenerate the solution**: **Regenerate full solution** on the details page asks AI to rewrite the answer and analysis (with confirmation before overwriting); knowledge points and the cause of the mistake stay unchanged.
- **🖼️ Question figures**: during recognition AI redraws figures as SVG, which is used on the details page, in printouts and in exams. Check the original photo with "View original image", or replace and add photos.
- **⭐ Difficulty stars**: on import AI rates difficulty from 1 to 5 stars following the star scale of a well-known Chinese math competition textbook series (1–2 stars: textbook and school extension, 3–4: regular math olympiad, 5: hardest competition problems). You can change it manually; questions with 4 stars or more go to paper B by default.
- **🏷️ Knowledge-point tags**: each notebook is created for a school stage (primary / junior high / senior high) and a subject (cannot be changed later). AI picks tags from all knowledge points of that stage and subject. Custom tags are supported, and AI can re-tag the knowledge points and difficulty of one question or a whole notebook.

### Explanations and demos

- **🎬 SVG animated explanations**: AI generates step-by-step SVG animations of the solution, with play/pause, seeking, replay and full screen. Click the speaker icon in the player for voice narration: the browser reads each step aloud, the animation waits for the narration before moving on, and the speed is adjustable. Older animations without a narration script read the on-screen subtitles. Animation text follows the interface language: the English interface generates an English version and the Chinese interface a Chinese one. Both are kept, and switching the language shows the matching version automatically. On by default; turn it off in **Settings → General**.
- **📐 GeoGebra demos**: for math and physics questions, AI can generate interactive GeoGebra figures. Off by default; turn it on in **Settings → General**.
- Generated animations and GeoGebra demos can be deleted (with confirmation).

### Review and practice

- **🔄 Practice similar questions**: generate variant questions (fill-in-the-blank or free response) on the same knowledge point, choose the difficulty and submit an answer: it is checked automatically (an identical answer is marked correct right away, otherwise the AI compares it with the reference answer and explains why), and you can change the result before saving. The most recently generated question and solution are kept for each mistake and shown directly next time; click Regenerate for a new one.
- **📈 Mastery probability**: AI estimates how likely you have mastered each question from the answer history of practice and exams. Questions fall into three states: **To Review** (no practice records yet), **Reviewing** (has records, probability below the mastered threshold) and **Mastered** (has records, probability at or above the threshold). The threshold is 50% by default and each user can adjust it in settings.
- **📅 Daily review**: each question is scheduled at Ebbinghaus intervals of 1, 2, 4, 7, 15 and 30 days. A correct answer moves it to the next interval; a wrong answer starts over. The **Review** page lists questions due today (earliest first), and the home page shows how many are due.
- **🧾 Mistake exams**: draw questions at random by notebook, knowledge point and mastery, and turn them into a printable exam of similar questions. After finishing, enter results per question; they are added to the original question's answer history.
- **🖨️ Print mistakes**: print filtered questions with your choice of question text or original image, answer, analysis and knowledge points, adjust image scale, then print or save as PDF.

### Management and statistics

- **🔍 Filters**: filter by mastery, date range, knowledge point, grade and term, paper level and more; supports bulk actions and comparing the similarity of two questions.
- **📊 Statistics**: mastery rate, monthly trend and subject distribution for both mistakes and practice.
- **⏳ Background tasks**: the button at the bottom right shows the progress of long-running jobs such as recognition, AI generation, bulk tagging and exam generation. Jobs keep running on the server after you leave the page.
- **💾 Import and export**: export or import data backups in **Settings**, including notebooks, questions, practice and answer records, exams and personal preferences; account credentials and AI settings are not included.
- **🕒 Application time zone**: Beijing time by default and changeable by administrators; dates and statistics follow the application time zone. See [TIME_ZONE.md](doc/TIME_ZONE.md) (Chinese).
- **🧭 Setup wizard**: on first sign-in the admin goes through a wizard: change the default password (required) → set up an AI provider (free MiniMax Code recommended) → create the first notebook. The last two steps can be skipped, and the wizard can be run again from **Settings → User Management**. Instances already in use are not interrupted after upgrading.
- **🔐 Multiple users and admin console**: sign-up and sign-in, with data isolated per user. New sign-ups are off by default and can be turned on under **Settings → User Management**, where admins can also cap daily AI use per user and see today's usage. Administrators open the admin console from **Settings → User Management** to view usage statistics and enable, disable or delete users.
- **🔌 Openclaw integration**: an external Openclaw agent can upload question images in bulk via `POST /api/openclaw/batch-upload`; see the environment variables below.

## 📸 Screenshot capture (HTTPS)

Screen capture requires a secure browser context (HTTPS). When running in Docker or on a LAN, follow the **[HTTPS setup guide](doc/HTTPS_SETUP.md)** (Chinese) to enable the built-in HTTPS support.

## 📱 PWA (add to home screen)

The app is a PWA: add it to your phone's or tablet's home screen to run it full screen and open it with one tap. Tablets can use it in landscape.

- **iPhone / iPad (Safari)**: tap **Share** at the bottom → **Add to Home Screen**.
- **Android (Chrome)**: tap the **menu** at the top right → **Add to Home screen** or **Install app**. You can also install the Android app from [Releases](https://github.com/margrop/wrong-notebook/releases) (see Installers below).

When served over HTTPS (or `localhost`), a service worker caches scripts, styles and icons so the app opens faster, and shows an offline page when the network is down. Questions, statistics and other data always come from the server and are not cached offline.

## 🛠️ Tech stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router) + [React 19](https://react.dev/) + TypeScript
- **Database**: [SQLite](https://www.sqlite.org/) (via [Prisma 5](https://www.prisma.io/))
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) (shadcn/ui-style components)
- **Formulas**: [KaTeX](https://katex.org/) (react-markdown + remark-math)
- **AI**: MiniMax / MiniMax Code (browser sign-in) / Zhipu GLM / DeepSeek / Kimi / Anthropic (and compatible APIs) / Azure OpenAI / OpenAI (and compatible APIs) / Google Gemini
- **Auth**: [NextAuth.js v4](https://next-auth.js.org/)
- **Testing**: Vitest (unit, integration), Playwright (E2E)

## 🚀 Quick Start

### Option 1: Run from source

1. **Requirements**: Node.js 22 or later (24 recommended) and npm.

2. **Clone and install dependencies**:

   ```bash
   git clone https://github.com/margrop/wrong-notebook.git
   cd wrong-notebook
   npm ci
   ```

3. **Configure environment variables**: copy `.env.example` to `.env` and fill it in as described in [Environment variables](#-environment-variables).

   ```bash
   cp .env.example .env
   ```

4. **Initialize the database**: create the schema and the admin account, then import the system knowledge points (same as the Docker build):

   ```bash
   npx prisma migrate dev
   npx prisma db seed
   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts
   ```

5. **Start the dev server**:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000` and sign in with the default admin account: email `admin@localhost`, password `123456`. The first sign-in opens the setup wizard: change the default password (required), then set up an AI provider and create your first notebook.

AI API keys can also be set in the web settings after signing in; see the AI model configuration section below.

### Option 2: Docker image (recommended)

Every release publishes an image to GitHub Container Registry, `ghcr.io/margrop/wrong-notebook`, for `linux/amd64` and `linux/arm64`. Pull it directly; no source code needed.

| Image tag | Description |
| --- | --- |
| Exact versions such as `2026.10.20` | Recommended; upgrade when you choose |
| `2026.10` | Latest release of the month |
| `latest` | Latest stable release |

See [Releases](https://github.com/margrop/wrong-notebook/releases) for available versions.

1. **Prepare directories and a secret**:

   ```bash
   mkdir -p wrong-notebook/data wrong-notebook/config
   cd wrong-notebook
   openssl rand -base64 32   # use the output as NEXTAUTH_SECRET
   ```

2. **Start the container** (either way):

   With `docker run`:

   ```bash
   docker run -d --name wrong-notebook \
     --restart always \
     -e NEXTAUTH_SECRET="secret-from-previous-step" \
     -e NEXTAUTH_URL="http://your-ip-or-domain:3000" \
     -p 3000:3000 \
     -v "$(pwd)/data:/app/data" \
     -v "$(pwd)/config:/app/config" \
     ghcr.io/margrop/wrong-notebook:latest
   ```

   With Docker Compose: download [`docker-compose.yml`](docker-compose.yml) into the current directory, set `NEXTAUTH_SECRET` (and `NEXTAUTH_URL`), then run:

   ```bash
   docker compose up -d
   ```

3. **Sign in**: open `http://your-ip-or-domain:3000` and sign in with the default admin account: email `admin@localhost`, password `123456`. The first sign-in opens the setup wizard: change the default password (required), then set up an AI provider and create your first notebook.

4. **Upgrade**: pull the new image and recreate the container. Data stays in the mounted directories; on startup only database migrations run.

   ```bash
   docker compose pull && docker compose up -d
   # With docker run: docker pull the new image, docker rm -f wrong-notebook, then run the docker run command above again
   ```

   Back up the `data/` directory before upgrading.

Data lives in the mounted `data/` (SQLite database) and `config/` (AI settings saved from the web UI, etc.) directories. **Settings → About** and `/api/health` show the running version. For HTTPS, see the [HTTPS setup guide](doc/HTTPS_SETUP.md) and `docker-compose.https.yml`.

> The upstream image `ghcr.io/wttwins/wrong-notebook` **does not include** the features added in this repository. Use `ghcr.io/margrop/wrong-notebook`.

### Option 3: Build the image from source

Build it yourself if you change the code or need unreleased changes. The build runs all tests inside the image and produces a production build:

```bash
docker build -t wrong-notebook:local .

docker run -d --name wrong-notebook \
  -e NEXTAUTH_SECRET="your_secret_key" \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config:/app/config" \
  wrong-notebook:local
```

With `docker-compose.yml`, change `image` to `wrong-notebook:local`.

### Option 4: Installers (npm / Windows / macOS / Linux / fnOS / Android)

If you prefer not to use Docker, download the desktop app or the fnOS package from [Releases](https://github.com/margrop/wrong-notebook/releases), or install with npm:

```bash
npm install -g wrong-notebook
wrong-notebook --port 3000
```

| Platform | Package |
| :--- | :--- |
| Windows | `WrongNotebook-Win-Setup-<version>-x64.exe` (installer), `WrongNotebook-Win-Portable-<version>-x64.exe` (portable) |
| macOS | `WrongNotebook-Mac-<version>-arm64.dmg` (Apple silicon), `WrongNotebook-Mac-<version>-x64.dmg` (Intel) |
| Linux | `WrongNotebook-Linux-<version>-<arch>.AppImage`, `.deb` |
| fnOS | `WrongNotebook-FnOS-<version>-x86.fpk`, `WrongNotebook-FnOS-<version>-arm.fpk` |
| Android phone / tablet (standalone) | `WrongNotebook-Android-Phone-<version>.apk` (portrait), `WrongNotebook-Android-Tablet-<version>.apk` (rotates between portrait and landscape) |
| Android phone / tablet (client) | `WrongNotebook-Android-Client-Phone-<version>.apk`, `WrongNotebook-Android-Client-Tablet-<version>.apk` |

The npm package needs Node.js 22.15 or later and stores data in `~/.wrong-notebook` by default. The desktop app listens on `127.0.0.1` only; the fnOS package needs Node.js v24 from the fnOS app center and is served on port 39300. The standalone Android app includes the server and works right after installation. Data stays on the device (uninstalling the app deletes it, and it is excluded from Android system backup because it contains API keys, so export a backup in Settings before uninstalling or switching phones); sign in with the default administrator `admin@localhost` / `123456` the first time and change the password when prompted. It needs a 64-bit ARM device with Android 8.0 or later. The Android client does not include the server: on first launch, enter the address of a deployed server (for example `http://192.168.1.10:3000`); you can change the server under Settings → About. It needs Android 7.0 or later. Both apps support taking photos for upload, saving exported files and system printing, and can be installed side by side.

Data directories, default accounts and local builds are described in [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md) (Chinese).

## 🔧 Environment variables

**Basics**

| Variable | Description | Default | Notes |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Database URL | Source: `file:./dev.db`; Docker: `file:/app/data/dev.db` | SQLite database path |
| `NEXTAUTH_SECRET` | Auth secret | None | Encrypts sessions; required in production. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Public URL | None | The URL users visit, e.g. `http://your-domain:3000` |
| `AUTH_TRUST_HOST` | Trust host header | `true` in the Docker image | When `true`, the URL is inferred from the request; suits Docker and reverse proxies |
| `LOG_LEVEL` | Log level | `debug` in development / `info` in production | `trace`, `debug`, `info`, `warn`, `error` or `fatal`; see [LOGGING_GUIDE.md](doc/LOGGING_GUIDE.md) (Chinese) |
| `DEBUG_DB` | SQL logs | `false` | When `true`, logs database queries |
| `HTTP_PROXY` / `HTTPS_PROXY` | Proxy | None | Proxy for requests to AI services |
| `ALLOW_REGISTRATION` | Allow sign-ups | `false` | When `true`, registration is open by default; the switch saved by an admin under **Settings → User Management** takes precedence |
| `AI_DAILY_LIMIT` | Daily AI limit per user | `0` (unlimited) | AI actions each regular user can start per day; admins are not limited. The value saved under **Settings → User Management** takes precedence |

**AI** (settings saved in the web UI take precedence over environment variables)

| Variable | Description | Default | Notes |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER` | AI provider | `minimax` | `minimax`, `minimax-code`, `glm`, `deepseek`, `kimi`, `anthropic`, `azure`, `openai` or `gemini` |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` | MiniMax | URL `https://api.minimax.cn/v1`, model `MiniMax-M3.1-Flash` | URL and model are optional |
| `MINIMAX_CODE_MODEL` | MiniMax Code model | `MiniMax-M3.1-Flash` | The account signs in from the web settings; no API key needed |
| `MINIMAX_CODE_AUTO_CHECKIN` | MiniMax Code daily auto check-in | `true` | Set to `false` to turn it off |
| `GLM_API_KEY` / `GLM_BASE_URL` / `GLM_MODEL` | Zhipu GLM | URL `https://open.bigmodel.cn/api/paas/v4`, model `glm-5.3-flash` | URL and model are optional |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | DeepSeek | URL `https://api.deepseek.com`, model `deepseek-flash` | URL and model are optional |
| `KIMI_API_KEY` / `KIMI_BASE_URL` / `KIMI_MODEL` | Kimi | URL `https://api.moonshot.cn/v1`, model `kimi-k3` | URL and model are optional |
| `ANTHROPIC_API_KEY` | Anthropic API key | None | From the [Claude Console](https://platform.claude.com/) |
| `ANTHROPIC_BASE_URL` | API URL | `https://api.anthropic.com` | For compatible services, use the URL without `/v1` |
| `ANTHROPIC_MODEL` | Model | `claude-sonnet-5-5` | e.g. `claude-opus-5-5`, `claude-haiku-5-5` |
| `AZURE_OPENAI_API_KEY` | Azure API key | None | From the Azure portal |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint | None | e.g. `https://xxx.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name | None | The deployment name configured in Azure |
| `AZURE_OPENAI_API_VERSION` | API version | `2024-02-15-preview` | |
| `AZURE_OPENAI_MODEL` | Model name | `gpt-4o` | Display only |
| `OPENAI_API_KEY` | OpenAI API key | None | From [OpenAI Platform](https://platform.openai.com/api-keys) |
| `OPENAI_BASE_URL` | OpenAI API URL | `https://api.openai.com/v1` | Set to the provider's URL for compatible services |
| `OPENAI_MODEL` | OpenAI model | `gpt-6.1-sol` | For compatible services, use the platform's model ID |
| `GOOGLE_API_KEY` | Gemini API key | None | From [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_BASE_URL` | Gemini API URL | Official URL | Usually unchanged |
| `GEMINI_MODEL` | Gemini model | `gemini-2.5-flash` | `gemini-3.8-flash` recommended |

**Openclaw integration** (optional)

| Variable | Description | Default | Notes |
| :--- | :--- | :--- | :--- |
| `OPENCLAW_API_URL` | Openclaw agent URL | None | URL of your local Openclaw agent |
| `OPENCLAW_API_KEY` | Openclaw API key | None | Used when calling the Openclaw agent |
| `OPENCLAW_TIMEOUT` | Timeout (ms) | `30000` | |
| `OPENCLAW_AUTH_MODE` | Auth mode | `credentials` | `credentials` (username and password) or `apikey` |
| `OPENCLAW_INTEGRATION_API_KEY` | This app's API key | None | Only for `apikey` mode, used by Openclaw to call this app. Generate with `openssl rand -hex 32` |

When adding environment variables, update `.env.example` as well.

## ⚙️ AI model configuration

AI settings can be changed in the web UI without restarting the server.

1. **Open settings**: as an administrator, click the settings icon at the top right of the home page and open **AI Provider**.
2. **Choose a provider**: MiniMax is the default. Choose from the official MiniMax channel, MiniMax Code OAuth (sign in with a MiniMax Code account in the browser), the official Zhipu GLM, DeepSeek and Kimi channels, Anthropic, Azure OpenAI, OpenAI (including compatible APIs) or Google Gemini; OpenAI supports several configurations you can switch between.
3. **Fill in the parameters**: API key, base URL (or endpoint) and model (or deployment name). Test the connection and fetch the model list from the API.
4. **Save**: settings are stored in `config/app-config.json` and take precedence over `.env`.

The **Prompts** tab lets you customize the prompt templates for recognition and similar-question generation.

### Model requirements

The selected model must meet these requirements, or some features will fail or work poorly:

| Requirement | Used by | Notes |
| :--- | :--- | :--- |
| **Image input (multimodal)** | Recognizing photos and screenshots, AI redrawing figures, regenerating solutions when an original image exists | Text-only models can only be used with text input; image recognition will fail |
| **Accurate SVG code** | Question figures, figures in similar questions and exams, SVG animated explanations | These "images" are SVG code written by the model. **No image-generation model is called** and the model does not need to output images; its geometry and SVG animation (SMIL) skills determine the quality of figures and animations |
| **Long single outputs** | SVG animated explanations (16384-token limit), question recognition with figures (8192-token limit) | A truncated output is retried once with 32768 tokens. With a maximum output below 16K, animated explanations often fail |
| **Strict output format** | All AI features | Results are parsed from tags such as `<answer_text>` and `<svg_animation>` or from JSON; a mismatch shows an error saying the AI response format is invalid and the model may be incompatible |
| **Valid LaTeX** | Questions, answers, analyses | Formulas must render in KaTeX; use **Fix LaTeX** on the details page if there are syntax errors |
| **Strong math reasoning** | Solutions, mistake analysis, difficulty stars, mastery estimates | Reasoning (thinking) models work; their thinking output is ignored. If thinking takes long, administrators can raise **AI Analysis Timeout** in **Settings → General** |

Use each provider's current multimodal flagship or fast model, such as `MiniMax-M3.1-Flash`, `glm-5.3-flash`, `deepseek-flash`, `kimi-k3`, `claude-sonnet-5-5`, `gpt-6.1-sol` or `gemini-3.8-flash`. For third-party models behind compatible APIs, make sure they support image input first.

### Configuration examples

#### Official Chinese model channels

These channels call each vendor's official OpenAI-compatible API, so only an API key is required. When the base URL and model are left empty, the defaults below are used (the mainland China endpoint and the vendor's latest multimodal model). For the international site, change the base URL to its address.

| Channel | API key | Default base URL | Default model |
| :--- | :--- | :--- | :--- |
| MiniMax | [MiniMax platform](https://platform.minimax.io) | `https://api.minimax.cn/v1` (international `https://api.minimax.io/v1`) | `MiniMax-M3.1-Flash` |
| Zhipu GLM | [Z.ai platform](https://z.ai) | `https://open.bigmodel.cn/api/paas/v4` (international `https://api.z.ai/api/paas/v4`) | `glm-5.3-flash` |
| DeepSeek | [DeepSeek platform](https://platform.deepseek.com) | `https://api.deepseek.com` | `deepseek-flash` |
| Kimi | [Kimi platform](https://platform.kimi.com) | `https://api.moonshot.cn/v1` (international `https://api.moonshot.ai/v1`) | `kimi-k3` |

#### MiniMax Code OAuth

**Free MiniMax accounts are supported**: sign in with a MiniMax Code account in the browser. No API key or paid plan is needed.

- **Automatic daily check-in**: once signed in, the app checks in every day and collects the MiniMax Code check-in credits (streaks earn more), so you don't need to open the client.
- **Uses free credits**: AI calls such as recognition, explanations, similar-question practice and grading use the account's free credits. The remaining credits are shown on the settings page.
- **Default model `MiniMax-M3.1-Flash`**: tested and working, with image input; `MiniMax-M3`, `MiniMax-M2.7` and others are also available.

To set it up, choose MiniMax Code OAuth in "Settings → AI Provider", click "Sign in with browser" and finish authorizing on the MiniMax page that opens. The settings page shows the login status, the remaining credits and whether today's check-in was done automatically.

The credentials are stored in `minimax-code.json` in the server's config directory (next to `app-config.json`, not included in data backups), and the access token is renewed automatically before it expires. Once signed in, the server checks every hour and collects the MiniMax Code daily check-in credits if today's check-in (Beijing time) has not been done yet. You can turn auto check-in off or check in right away on the settings page. This channel uses the sign-in of the MiniMax Code desktop client (OAuth device authorization) rather than an official open API, so MiniMax may change or restrict it at any time. Follow MiniMax's terms of service.

#### Anthropic

| Parameter | Where to get it |
| :--- | :--- |
| API key | [Claude Console](https://platform.claude.com/) → API Keys |
| Base URL | Default `https://api.anthropic.com`; usually unchanged |
| Model | `claude-sonnet-5-5` (recommended), `claude-opus-5-5`, `claude-haiku-5-5`, etc. |

> **Compatible services**: the Anthropic provider also works with third-party services that implement the Anthropic Messages API. Enter the base URL from the provider without `/v1` (the app appends `/v1/messages`) and the platform's model ID. Thinking output from reasoning models is ignored.

#### Azure OpenAI

| Parameter | Where to get it |
| :--- | :--- |
| API key | Azure portal → your OpenAI resource → Keys and Endpoint |
| Endpoint | Azure portal → your OpenAI resource → Endpoint, e.g. `https://xxx.openai.azure.com` |
| Deployment name | The model deployment name configured in Azure, e.g. `gpt-4o` |
| API version | Default `2024-02-15-preview` |

#### OpenAI

| Parameter | Where to get it |
| :--- | :--- |
| API key | [OpenAI Platform](https://platform.openai.com/api-keys) → Create new secret key |
| Base URL | Default `https://api.openai.com/v1` |
| Model | `gpt-6.1-sol` (recommended), etc. |

> **Compatible services**: the OpenAI provider works with any third-party service that implements the OpenAI API format. Set the base URL to the service's address to use models from platforms such as SiliconFlow or Alibaba DashScope, and enter the platform's full model ID.

#### Google Gemini

| Parameter | Where to get it |
| :--- | :--- |
| API key | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key |
| Base URL | Default `https://generativelanguage.googleapis.com`; usually unchanged |
| Model | `gemini-3.8-flash` (recommended), etc. |

> **Permissions**: AI settings, prompts, connection tests and model lists are admin-only. Regular users can only change their own preferences in **Settings → General** (review before importing, SVG animated explanations, GeoGebra demos, duplicate threshold, mastered threshold). The application time zone is set by administrators.

## 🧪 Development and testing

```bash
npm run lint                # ESLint (fails on any warning)
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
npm test                    # All Vitest tests
npm run test:coverage       # Test coverage (fails below the minimum thresholds)
npm run test:e2e            # Playwright E2E (run node scripts/prepare-e2e.js first to set up test accounts)
bash scripts/ci.sh          # Full CI (Node.js 22+, Python 3, includes production build)
```

After changing `prisma/schema.prisma`, create a migration with `npx prisma migrate dev --name <name>` and commit it; migrations must be compatible with existing data. See [AGENTS.md](AGENTS.md) for more development conventions.

## 📚 Documentation

For usage, deployment and FAQ, see the [Wiki in English](https://github.com/margrop/wrong-notebook/wiki/Home-en) (also available in [Chinese](https://github.com/margrop/wrong-notebook/wiki)). The topic documents below are mostly written in Simplified Chinese.

| Document | Content |
| :--- | :--- |
| [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md) | npm, desktop, fnOS and Android packages and builds |
| [HTTPS_SETUP.md](doc/HTTPS_SETUP.md) | HTTPS setup (needed for screen capture) |
| [TIME_ZONE.md](doc/TIME_ZONE.md) | Application time zone |
| [LOGGING_GUIDE.md](doc/LOGGING_GUIDE.md) | Logging |
| [MARKDOWN_GUIDE.md](doc/MARKDOWN_GUIDE.md) | Markdown and formulas |
| [TABLE_RECOGNITION.md](doc/TABLE_RECOGNITION.md) | Table recognition |
| [PROJECT_OVERVIEW.md](doc/PROJECT_OVERVIEW.md), [operational_flow.md](doc/operational_flow.md) | Project structure and workflows (partly predates features added in this repository) |
| [release-guide.md](doc/release-guide.md) | Releasing |
| [BRANCH_WORKFLOW.md](doc/BRANCH_WORKFLOW.md) | Public mainline and pre-push checks |
| [setup-wsl-network.md](doc/setup-wsl-network.md) | WSL networking |

## 🛠️ Utility scripts

The `scripts/` directory contains maintenance and debugging scripts, for example:

- **Reset a password**: `node scripts/reset-password.js <email> <new-password>`
- **Recreate the admin**: `node scripts/seed-admin.js` (default `admin@localhost` / `123456`)
- **Rebuild system knowledge points**: `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts` (keeps custom tags and question links; back up before running in production)
- **Inspect the database**: `node scripts/check-db-users.js`, `node scripts/check-db-data.js`

## 🤝 Contributing

Issues and pull requests are welcome. Please read the [contributing guide](CONTRIBUTING.md) (Chinese) and the [code of conduct](CODE_OF_CONDUCT.md). For questions and bug reports, see [getting help](SUPPORT.md). Report security vulnerabilities privately as described in the [security policy](SECURITY.md). See the [changelog](CHANGELOG.md) (Chinese) for changes in each stable release.

## 📄 License

[MIT License](LICENSE)

© 2026 margrop. This project extends [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook); copyright in the original code remains with its author.
