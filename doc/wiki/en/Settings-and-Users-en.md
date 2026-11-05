# Settings and Users

## Personal preferences

After signing in, open "Settings → General" to adjust your own preferences:

| Setting | Default |
| --- | --- |
| Review before import | When on, review before saving; useful when every question must be checked |
| Grade recognition for new questions | Fixed mode by default: use the chosen grade and semester, or the current account grade if unset; AI recognition is also available |
| SVG animated explanations | On |
| GeoGebra interactive demos | Off |
| Duplicate similarity threshold | 90%; a question is a duplicate when the similarity is strictly greater |
| Mastered threshold | 50%; a question counts as mastered once its mastery probability reaches it |

The interface theme is not in Settings; switch it with the theme button in the top navigation bar: Auto (follow system, the default), Light or Dark. It is also saved per user and carries over when you sign in on another device.

Personal preferences are saved per user. The AI service configuration and the app time zone are global settings that require admin rights.

## Grade recognition for new questions

Choose a rule under **Settings → General** and click **Save grade rule**. Regular users and admins each manage their own rule.

- **Fixed grade**: use the selected grade and semester. If unset, calculate the current grade from the account's school stage, enrollment year and app time zone. An explicitly selected fixed value stays the same across school years.
- **AI recognition**: infer the grade and semester from the question, knowledge points and curriculum progress, without injecting the student's current grade. Leave them unset when uncertain.
- Applies to image recognition, text solving, batch selection, direct entry and Openclaw uploads. A grade entered manually or changed during review takes priority.
- Image recognition and text solving return the grade in the same AI request. Direct entry and external results missing a grade use one short additional request, counted toward the daily AI limit. Duplicates do not trigger it; an attempted but uncertain result is not requested again.
- Affects new questions only. Existing questions and grades restored from backups stay as they were. Your rule and fixed value are included in your JSON backup.

## App time zone

The app uses Beijing time, `Asia/Shanghai`, by default. Admins enter a valid IANA time zone name in "Settings → General → App time zone" and save, for example `UTC`, `Europe/London` or `America/New_York`.

The time zone is stored in the `timeZone` field of `config/app-config.json`. Older configurations without this field fall back to `Asia/Shanghai`; regular users can see the current global time zone.

These features use the app time zone:

- Dates shown on questions, practice history, exam papers and admin pages.
- The time in default exam titles, export file names and exam date entry.
- Daily and monthly statistics, and grade and semester calculation.

ISO times ending in `Z` in the database and API still represent the same absolute instant and are converted for display. After saving, the current page uses the new time zone and other open pages pick it up after a refresh; saved exam titles are not rewritten.

See the [time zone notes](https://github.com/margrop/wrong-notebook/blob/main/doc/TIME_ZONE.md) for details.

## AI data sharing

AI features send the question text, images, answers, reference answers and explanations needed for the task to the third-party AI provider set by the administrator. After signing in for the first time, every account (admins included) sees an "AI data sharing" dialog listing the data sent, the current provider and the [privacy policy](https://wrong-notebook.margrop.net/en/privacy/). AI features work only after the user agrees:

- "Not now" stops the dialog from opening by itself for the rest of the browsing session. Using any AI feature opens it again; after agreeing, repeat the action once.
- Without consent the server rejects AI requests (error code `AI_CONSENT_REQUIRED`) and sends nothing to the provider; mastery is estimated by rules, and everything else keeps working.
- Under **Settings → Account → AI data sharing** you can see when you agreed, and allow or withdraw. Withdrawing does not affect data already sent to the provider.
- Consent is stored with the account and is not included in backup exports or imports. Accounts created before this version must agree once as well; an account used only through [Openclaw](Openclaw-Integration-en) must sign in on the web and agree first.

## Permissions and user management

| Role | Main permissions |
| --- | --- |
| Regular user | Manage their own questions, practice, exam papers and preferences; import and export their own data |
| Admin | Global AI and prompt settings, time zone, registration switch, user management and site-wide data import/export |

Admins open the dashboard from "Settings → User Management" to see usage statistics and enable, disable or delete users. Confirm the target and [back up your data](Backup-and-Restore-en) before deleting.

Regular users can delete their own account under "Settings → Danger → Delete Account" by entering their current password. The account and all of its data (questions, notebooks, tags, practice records, exam papers, etc.) are permanently deleted and the user is signed out; this cannot be undone, so export anything you want to keep first. Admin accounts cannot delete themselves, so the instance never loses its administrator; to clear data, use System Initialization on the same page.

New sign-ups are off by default, so strangers cannot register and use up your AI quota when the service is reachable from the internet. To create accounts for family members, an admin turns on "Allow New Registrations" under "Settings → User Management" and turns it off again once the accounts exist. The environment variable `ALLOW_REGISTRATION=true` changes the default; a switch saved on the web page takes precedence. Instances that saved settings on the web page before upgrading keep their existing switch. While sign-ups are off, the sign-in page hides "Register now" and asks visitors to contact the administrator.

### Daily AI limit

To keep children from using up your API quota by regenerating explanations and questions, admins can set "Daily AI Limit per User" under "Settings → User Management". The user list also shows how many AI actions each person has used today.

- Counted actions are the AI features a user starts: recognizing questions, re-solving, generating and grading practice questions, figures, LaTeX fixes, GeoGebra, animated explanations (including narration scripts), re-tagging and exam papers. Each action counts once; a whole exam paper or re-tagging a whole notebook also counts once. An answer that matches the reference exactly is marked without the AI and does not count; cloud voice synthesis uses the speech provider's quota and does not count either.
- Mastery evaluation that runs automatically in the background is not counted.
- 0 means unlimited (the default); admins are not limited. The environment variable `AI_DAILY_LIMIT` sets the default; a value saved on the web page takes precedence.
- Counts reset at midnight in the application time zone. Once the limit is reached, AI features show "You have used up today's AI allowance".

### AI concurrency per model

When several people recognize questions or generate explanations at once, a burst of requests is easily rejected by the provider with a 429 rate-limit error. Admins can set "AI Concurrency per Model" under "Settings → User Management":

- AI calls to the same provider, API address and model never exceed the limit at the same time. Further calls wait in a queue and start in order as earlier ones finish; different models are counted separately.
- Values range from 1 to 100, default 5. Lower it when the provider limits strictly (free quotas, trial plans); raise it when calls queue for long without any 429 errors.
- A saved value applies to later calls immediately. The environment variable `AI_CONCURRENCY_LIMIT` sets the default; a value saved on the web page takes precedence.
- Time spent in the queue counts toward the AI timeout on the page, so a task that waits too long may show a timeout.

Fresh installs create the first admin with a one-time setup link (see the [FAQ](FAQ-en)) instead of shipping a default admin with a fixed password. Upgrades keep existing accounts; `scripts/seed-admin.js` only restores the admin role of an existing `admin@localhost` and never creates an account.

## Background tasks and progress

The task entry at the bottom right of the page shows the status of long operations such as recognition, animations, narration scripts, animation voice (cloud voice), re-solving, batch tagging, data import and exam generation. Some batch tasks show processed and failed counts.

The percentage on the entry screen is an estimate by stage (compress, upload, analyze, process, save), not the AI's real progress; the elapsed time shows how long you have been waiting.

The task list lives in the server process's memory. Navigating away usually does not stop processing that has already started on the server, but a restart clears the list and running tasks are not resumed from it. Completed business data is whatever was saved to the database.

## Check the running version

"About" in the settings and `GET /api/health` both show the running version. When troubleshooting, note the version, the steps to reproduce and the redacted error message; do not send real API keys or full configuration files.

## PEP curriculum knowledge points

Admins can import the PEP curriculum tag system as a second tag library alongside the built-in one:

1. Download the required JSON file: [topics.json](https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json) (about 2.6 MB, from [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)).
2. Open "Settings → User Management → PEP Curriculum Knowledge Points" and click "Select topics.json and Import".

The data is mainly math and also covers Chinese, English, physics, history, geography and morality & law (filed under politics); unsupported subjects such as primary science are skipped. The import is incremental and safe to repeat, and does not change the built-in tag system or existing questions. Afterwards, "PEP Curriculum Standard" can be chosen under "Tag System" when creating a notebook; it cannot be changed later. The command-line equivalent is `npx tsx scripts/seed-cnm-tags.ts <file path>`.

## Debug logs

When a problem is hard to describe, an admin can export a debug log and send it to the author:

1. Open "Settings → User Management" and turn on "Debug mode" under "Debug Logs" (turning it on clears the previous recording).
2. Reproduce the problem; the panel shows how many entries have been recorded.
3. Click "Export Debug Log" to download `wrong-notebook-debug-<time>.json` and attach it to your issue. You can then turn debug mode off.

Debug mode records every server log, including the `debug` and `trace` levels that `LOG_LEVEL` normally hides (such as AI requests and responses), plus uncaught browser errors from all users. The export also contains the running version, system environment and redacted configuration.

- API keys, passwords, tokens, cookies and similar fields are replaced with `[REDACTED]` on export, and images keep only their type and size. The log may still contain question text and usernames, so review it before sending if you like.
- The log lives only in the server process's memory and keeps at most 5000 entries (the oldest are discarded first). Debug mode turns off 24 hours after it is enabled, and a restart clears the log.
