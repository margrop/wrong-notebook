# Development

See [Quick Start](Quick-Start-en) for setting up a development environment. Before submitting changes, read the repository's [AGENTS.md](https://github.com/margrop/wrong-notebook/blob/main/AGENTS.md) and the [public mainline workflow](https://github.com/margrop/wrong-notebook/blob/main/doc/BRANCH_WORKFLOW.md).

## Stack and code map

The project uses the Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Radix UI, Prisma 5, SQLite and NextAuth v4; formulas are rendered with KaTeX.

| Directory or file | Responsibility |
| --- | --- |
| `src/app/` | Pages and API routes |
| `src/components/` | Feature components and base UI |
| `src/lib/ai/` | AI providers, prompts, result schemas and validation |
| `src/lib/config/` | Global settings and configuration file access |
| `src/lib/question/question-deduplication.ts` | Import duplicate detection and repeated-attempt records |
| `src/lib/mastery.ts`, `src/lib/exam/exam.ts` | Mastery evaluation and exam generation |
| `src/lib/date-time.ts` | App time zone, display and statistics boundaries |
| `src/lib/translations.ts`, `src/lib/i18n/` | Interface text (entry point and per-language strings) |
| `prisma/` | Data model, formal migrations and seed data |
| `src/__tests__/`, `e2e/`, `tests/publication/` | Unit, integration, E2E and publication check tests |
| `scripts/`, `doc/` | Maintenance scripts and topic documents |

AI requests are dispatched to a provider on the server and call external services; business data is stored in SQLite through Prisma. The background task list lives in process memory and is mirrored to `background-tasks.json` in the config directory; after a restart only the records remain and nothing resumes, so it is not a substitute for a persistent job queue.

Photo recognition uses the database-backed `ImportTask` (`/api/import-tasks`): the upload returns a task ID immediately, recognition and saving run after the response via `after()`, and the result, draft and final question ID are persisted. State changes are claimed with conditional `updateMany`, and writing the question and marking the task saved commit in the same transaction. Running tasks record the process boot ID, so a single-process deployment marks them interrupted right after a restart; multi-instance deployments (Vercel) use a heartbeat timeout. `/api/analyze` stays as the synchronous endpoint and shares `src/lib/question/question-analysis.ts` with tasks; saving shares `src/lib/question/question-save.ts` with the add-question endpoint.

HEIC/HEIF conversion depends on `heic-to` (LGPL-3.0, containing libheif, libde265 and the Emscripten runtime), which is loaded dynamically only when the browser cannot decode the photo itself. Its third-party notice and full license texts are in `public/third-party-licenses/heic-to/` and ship with `public/` in every distribution. When upgrading `heic-to`, check the versions, license texts and upstream source links in that directory as well.

## Common checks

### List API payloads

`GET /api/error-items/list` returns card fields by default, with tag names only. It excludes original images, OCR, answers, explanations, figures, animations and saved practice data. Use `GET /api/error-items/:id` for details. Print preview adds `view=print` to the list request to retrieve the answer, explanation, figure, grade/term, paper level and notebook name. Original images are not embedded: `originalImageUrl` becomes a `GET /api/error-items/:id/image?v=<updated time>` link that the page lazy-loads and fully loads right before printing. The image endpoint only serves PNG, JPEG, WebP and GIF bitmaps; the link changes when the image is replaced, so it can be cached long-term. Both views share authentication, user scope, filters and pagination. The default response is a summary, not a complete `ErrorItem`.

`src/__tests__/integration/error-list-payload.test.ts` uses an isolated SQLite database to verify large images, animations, pagination and printing. The default response for 18 questions must stay below 12 KiB to prevent large fields from returning to the list. Paired benchmarks and their report are in `perf/`.

### Commands

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

Run `npm run test:e2e` to prepare an isolated production app, a migrated temporary SQLite database, test accounts and a local AI mock automatically. Tests use a dummy key and block external model connections. Reports are kept in the system temporary directory. Filter cases with `npm run test:e2e -- --grep E2E-M01`.

CI runs `npm run lint` and fails on any ESLint error or warning.

CI for `main` and pull requests also builds the complete image with the production Dockerfile on native amd64 and arm64 runners, covering Vitest in Alpine, script syntax checks, database initialization and the production build without publishing images. `.dockerignore` must keep the `e2e/support` modules reused by unit tests while excluding browser test cases and test output from the build context.

`npm run test:coverage` measures test coverage of `src/lib` and `src/app/api` and fails below the thresholds in `vitest.config.mts`; CI shows the coverage in the job summary and uploads the report.

`npm test` runs all Vitest tests. The E2E environment and startup are defined in the repository's [`playwright.config.ts`](https://github.com/margrop/wrong-notebook/blob/main/playwright.config.ts).

The full CI needs Node.js 22 or later and Python 3, and covers dependency installation, Prisma Client generation, lint, Vitest, publication checks, script syntax checks and the production build:

```bash
bash scripts/ci.sh
```

After changing logic, run at least the unit and integration tests. Changes to documentation, styles or comments alone may skip the logic tests per the repository rules; do not run the production build unless asked or as part of the full CI.

## Fork extension points

Fork projects (for example an "AI question bank") can customize features through extension points reserved upstream with minimal changes to upstream files; see [doc/FORK_EXTENSION_POINTS.md](https://github.com/margrop/wrong-notebook/blob/main/doc/FORK_EXTENSION_POINTS.md).

## Conventions

- Replies, code comments and commit messages are written in Simplified Chinese; commits follow `type: description`.
- TypeScript avoids `any`; type imports use `import type`; the `@/` alias points to `src/`.
- React components declare Props types, and large components are split; pages work on both mobile and desktop.
- Interface text goes into `translations.ts` (Chinese and English keys must match, which a unit test checks); API errors use `api-errors`; front end and back end use the project loggers.
- Validate user input with zod first, and query the database through Prisma's parameterized APIs.

## Changing AI features

AI business methods are implemented once in `src/lib/ai/base-provider.ts`. The providers — Gemini, OpenAI (including the MiniMax, GLM, DeepSeek, Kimi, Qwen, StepFun and Volcengine channels), Azure and Anthropic — only implement request transport and their own request differences, so a new AI feature only changes the base class. Prompts live in the `prompts/` directory; the type and format contract of generated questions is also validated by modules such as `generated-question.ts`.

Cover normal results, malformed output, timeouts and truncated output when verifying. After changing an output structure, also check callers such as practice, exam papers, figures and re-solving.

## Database changes

After changing `prisma/schema.prisma`, generate a formal migration against the development database and commit the migration directory:

```bash
npx prisma migrate dev --name change_name
```

Production uses formal migrations with `PRESERVE_EXISTING_DATA=true`, and migrations must be compatible with existing accounts and questions. Never replace production migrations with development database reset commands.

## Public mainline and releases

`main` contains only publishable source code, generic deployment examples and documentation; the public remote is named `github` by convention. Private deployment branches only receive changes from the public mainline and must never be merged back into public history.

Enable the hooks in every working copy and run the check before pushing publicly:

```bash
git config core.hooksPath .githooks
python3 scripts/check-public-history.py main
```

Before pushing to GitHub, show `git status` and the diff to be pushed and get confirmation; this applies to branches, tags and history rewrites. The check must cover the refs actually being pushed, not just the files in the working tree.

Versions are tagged by release date; image publishing steps are in the [release guide](https://github.com/margrop/wrong-notebook/blob/main/doc/release-guide.md). Keep credentials in `.env` or untracked configuration files, and add new environment variables to `.env.example`. Put screenshots, logs and experiment scripts in a system temporary directory.
