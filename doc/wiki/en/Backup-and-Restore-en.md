# Backup and Restore

Web export is for moving personal learning data; restoring a whole site requires backing up the database, server configuration and deployment parameters.

## What each backup covers

| Method | Contents | Use |
| --- | --- | --- |
| Web JSON export | Notebooks, custom tags, questions, review schedules, practice records, random exam papers and some profile data | Keeping personal data, importing supported fields |
| Full-site file backup | The complete SQLite database, `config/`, deployment configuration and any certificates | Disaster recovery, moving the site, preparing a rollback before upgrades |

The JSON export does not include full user accounts with passwords or the server AI configuration. Even when an admin exports all data, it does not replace a full-site backup.

## Web export and import

Export JSON from the data management section in the settings and keep it safe. When a regular user imports, the email in the export file must match the current account; admins can import and export data for all users.

Question figures, GeoGebra demos, Chinese and English SVG animations with their synthesized cloud voice (MP3), the latest similar question and mastery probability are all restored from the export file; SVG is sanitized again on import, and questions without a mastery probability are re-evaluated after import. Exam papers are restored together with their questions and every recorded result; questions still being generated at export time show as failed after import and can be regenerated on the exam page. Importing your own export file also restores preferences such as review before import, the duplicate threshold, GeoGebra demos and SVG animations.

Import merges existing notebooks and tags and handles duplicates by question similarity. A duplicate may add another wrong attempt under the existing question, so importing the same file repeatedly can change the practice history.

Keep the original backup before importing, and afterwards check the new questions, tags, duplicate count and answer history. To restore to an exact point in time, use a file backup.

## Docker full-site backup

This example uses the directory layout from the [deployment guide](Deployment-en). Stopping the app before archiving keeps the SQLite data file, its WAL/SHM files and the configuration consistent.

Run in the deployment directory:

```bash
mkdir -p backups
docker compose stop wrong-notebook
backup_file="backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" data config docker-compose.yml .env
docker compose start wrong-notebook
tar -tzf "$backup_file"
```

If the backup fails, do not continue with the upgrade; fix the cause and confirm the service is back first. When using the built-in HTTPS, add `certs/` to the archive, along with any other deployment files.

Backups may contain question images, user profiles, password hashes and AI credentials. Restrict access, keep them in a separate location, check that the archive can be read, and verify the restore process in an isolated environment.

## Restore the whole site

1. Confirm the backup time, source version and archive contents; keep another copy of the current data and configuration.
2. Stop the app so nothing is written to the database during the restore.
3. Unpack and check the backup in a separate directory, then restore `data/`, `config/` and the required deployment files.
4. Prefer the image version that matches the backup, and keep the correct mount paths and `NEXTAUTH_SECRET`.
5. After starting, check `/api/health`, then sign in and check users, questions, tags, answer history and exam papers.

Do not switch an old database back and forth between incompatible versions. When an upgrade is needed, run the [upgrade steps](Deployment-en) separately after the restore has been verified.

## Backups when running from source

The default SQLite file is `prisma/dev.db`; the actual location is decided by `DATABASE_URL`. Stop the service, then back up the directory holding the actual database, `config/`, `.env` and the version information. When restoring, use the matching code and dependencies, and run the formal migrations if needed.

Sources: [export](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/export/route.ts) · [import](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/import/route.ts) · [data model](https://github.com/margrop/wrong-notebook/blob/main/prisma/schema.prisma).
