# Development

See [Quick Start](Quick-Start-en) for setting up a development environment. Before submitting changes, read the repository's [AGENTS.md](https://github.com/margrop/wrong-notebook/blob/main/AGENTS.md) and the [public mainline workflow](https://github.com/margrop/wrong-notebook/blob/main/doc/BRANCH_WORKFLOW.md).

## Stack and code map

The project uses the Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Radix UI, Prisma 5, SQLite and NextAuth v4; formulas are rendered with KaTeX.

| Directory or file | Responsibility |
| --- | --- |
| `src/app/` | Pages and API routes |
| `src/components/` | Feature components and base UI |
| `src/lib/ai/` | AI providers, prompts, result schemas and validation |
| `src/lib/config.ts` | Global settings and configuration file access |
| `src/lib/question-deduplication.ts` | Import duplicate detection and repeated-attempt records |
| `src/lib/mastery.ts`, `src/lib/exam.ts` | Mastery evaluation and exam generation |
| `src/lib/date-time.ts` | App time zone, display and statistics boundaries |
| `src/lib/translations.ts` | Interface text |
| `prisma/` | Data model, formal migrations and seed data |
| `src/__tests__/`, `e2e/`, `tests/publication/` | Unit, integration, E2E and publication check tests |
| `scripts/`, `doc/` | Maintenance scripts and topic documents |

AI requests are dispatched to a provider on the server and call external services; business data is stored in SQLite through Prisma. The background task list lives in process memory and is not a substitute for a persistent job queue.

## Common checks

### List API payloads

`GET /api/error-items/list` returns card fields by default, with tag names only. It excludes original images, OCR, answers, explanations, figures, animations and saved practice data. Use `GET /api/error-items/:id` for details. Print preview adds `view=print` to the list request to retrieve the original image, answer, explanation, figure, grade/term, paper level and notebook name. Both views share authentication, user scope, filters and pagination. The default response is a summary, not a complete `ErrorItem`.

`src/__tests__/integration/error-list-payload.test.ts` uses an isolated SQLite database to verify large images, animations, pagination and printing. The default response for 18 questions must stay below 12 KiB to prevent large fields from returning to the list. Paired benchmarks and their report are in `perf/`.

### Commands

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

E2E tests sign in as admin with a non-default password (the default admin must change it). Run `node scripts/prepare-e2e.js` first: it sets the `admin@localhost` password to `E2E_ADMIN_PASSWORD` (default `e2e-admin-pass`) and creates `setup-admin@localhost`, which still uses the default password. If port 3000 is busy, start a dev server elsewhere and point `E2E_BASE_URL` at it.

CI runs `npm run lint` and fails on any ESLint error or warning.

`npm run test:coverage` measures test coverage of `src/lib` and `src/app/api` and fails below the thresholds in `vitest.config.ts`; CI shows the coverage in the job summary and uploads the report.

`npm test` runs all Vitest tests. The E2E environment and startup are defined in the repository's [`playwright.config.ts`](https://github.com/margrop/wrong-notebook/blob/main/playwright.config.ts).

The full CI needs Node.js 22 or later and Python 3, and covers dependency installation, Prisma Client generation, lint, Vitest, publication checks, script syntax checks and the production build:

```bash
bash scripts/ci.sh
```

After changing logic, run at least the unit and integration tests. Changes to documentation, styles or comments alone may skip the logic tests per the repository rules; do not run the production build unless asked or as part of the full CI.

## Conventions

- Replies, code comments and commit messages are written in Simplified Chinese; commits follow `type: description`.
- TypeScript avoids `any`; type imports use `import type`; the `@/` alias points to `src/`.
- React components declare Props types, and large components are split; pages work on both mobile and desktop.
- Interface text goes into `translations.ts` (Chinese and English keys must match, which a unit test checks); API errors use `api-errors`; front end and back end use the project loggers.
- Validate user input with zod first, and query the database through Prisma's parameterized APIs.

## Changing AI features

AI logic changes must consider all providers: Gemini, OpenAI (including the MiniMax, GLM, DeepSeek, Kimi and Qwen channels), Azure and Anthropic. Prompts live in `prompts.ts`; the type and format contract of generated questions is also validated by modules such as `generated-question.ts`.

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
