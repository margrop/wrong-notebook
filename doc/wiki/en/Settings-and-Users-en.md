# Settings and Users

## Personal preferences

After signing in, open "Settings → General" to adjust your own preferences:

| Setting | Default |
| --- | --- |
| Review before import | When on, review before saving; useful when every question must be checked |
| SVG animated explanations | On |
| GeoGebra interactive demos | Off |
| Duplicate similarity threshold | 90%; a question is a duplicate when the similarity is strictly greater |
| Mastered threshold | 50%; a question counts as mastered once its mastery probability reaches it |

Personal preferences are saved per user. The AI service configuration and the app time zone are global settings that require admin rights.

## App time zone

The app uses Beijing time, `Asia/Shanghai`, by default. Admins enter a valid IANA time zone name in "Settings → General → App time zone" and save, for example `UTC`, `Europe/London` or `America/New_York`.

The time zone is stored in the `timeZone` field of `config/app-config.json`. Older configurations without this field fall back to `Asia/Shanghai`; regular users can see the current global time zone.

These features use the app time zone:

- Dates shown on questions, practice history, exam papers and admin pages.
- The time in default exam titles, export file names and exam date entry.
- Daily and monthly statistics, and grade and semester calculation.

ISO times ending in `Z` in the database and API still represent the same absolute instant and are converted for display. After saving, the current page uses the new time zone and other open pages pick it up after a refresh; saved exam titles are not rewritten.

See the [time zone notes](https://github.com/margrop/wrong-notebook/blob/main/doc/TIME_ZONE.md) for details.

## Permissions and user management

| Role | Main permissions |
| --- | --- |
| Regular user | Manage their own questions, practice, exam papers and preferences; import and export their own data |
| Admin | Global AI and prompt settings, time zone, registration switch, user management and site-wide data import/export |

Admins open the dashboard from "Settings → User Management" to see usage statistics and enable, disable or delete users. Confirm the target and [back up your data](Backup-and-Restore-en) before deleting.

New sign-ups are off by default, so strangers cannot register and use up your AI quota when the service is reachable from the internet. To create accounts for family members, an admin turns on "Allow New Registrations" under "Settings → User Management" and turns it off again once the accounts exist. The environment variable `ALLOW_REGISTRATION=true` changes the default; a switch saved on the web page takes precedence. Instances that saved settings on the web page before upgrading keep their existing switch. While sign-ups are off, the sign-in page hides "Register now" and asks visitors to contact the administrator.

### Daily AI limit

To keep children from using up your API quota by regenerating explanations and questions, admins can set "Daily AI Limit per User" under "Settings → User Management". The user list also shows how many AI actions each person has used today.

- Counted actions are the AI features a user starts: recognizing questions, re-solving, generating and grading practice questions, figures, LaTeX fixes, GeoGebra, animated explanations (including narration scripts), re-tagging and exam papers. Each action counts once; a whole exam paper or re-tagging a whole notebook also counts once. An answer that matches the reference exactly is marked without the AI and does not count; cloud voice synthesis uses the speech provider's quota and does not count either.
- Mastery evaluation that runs automatically in the background is not counted.
- 0 means unlimited (the default); admins are not limited. The environment variable `AI_DAILY_LIMIT` sets the default; a value saved on the web page takes precedence.
- Counts reset at midnight in the application time zone. Once the limit is reached, AI features show "You have used up today's AI allowance".

Fresh installs create the first admin with a one-time setup link (see the [FAQ](FAQ-en)) instead of shipping a default admin with a fixed password. Upgrades keep existing accounts; `scripts/seed-admin.js` only restores the admin role of an existing `admin@localhost` and never creates an account.

## Background tasks and progress

The task entry at the bottom right of the page shows the status of long operations such as recognition, animations, narration scripts, animation voice (cloud voice), re-solving, batch tagging, data import and exam generation. Some batch tasks show processed and failed counts.

The percentage on the entry screen is an estimate by stage (compress, upload, analyze, process, save), not the AI's real progress; the elapsed time shows how long you have been waiting.

The task list lives in the server process's memory. Navigating away usually does not stop processing that has already started on the server, but a restart clears the list and running tasks are not resumed from it. Completed business data is whatever was saved to the database.

## Check the running version

"About" in the settings and `GET /api/health` both show the running version. When troubleshooting, note the version, the steps to reproduce and the redacted error message; do not send real API keys or full configuration files.

## Debug logs

When a problem is hard to describe, an admin can export a debug log and send it to the author:

1. Open "Settings → User Management" and turn on "Debug mode" under "Debug Logs" (turning it on clears the previous recording).
2. Reproduce the problem; the panel shows how many entries have been recorded.
3. Click "Export Debug Log" to download `wrong-notebook-debug-<time>.json` and attach it to your issue. You can then turn debug mode off.

Debug mode records every server log, including the `debug` and `trace` levels that `LOG_LEVEL` normally hides (such as AI requests and responses), plus uncaught browser errors from all users. The export also contains the running version, system environment and redacted configuration.

- API keys, passwords, tokens, cookies and similar fields are replaced with `[REDACTED]` on export, and images keep only their type and size. The log may still contain question text and usernames, so review it before sending if you like.
- The log lives only in the server process's memory and keeps at most 5000 entries (the oldest are discarded first). Debug mode turns off 24 hours after it is enabled, and a restart clears the log.
