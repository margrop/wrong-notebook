# Backup and Restore

Web export is for moving personal learning data; restoring a whole site requires backing up the database, server configuration and deployment parameters.

## What each backup covers

| Method | Contents | Use |
| --- | --- | --- |
| Web JSON export (full backup) | Notebooks, system and custom tags, questions, review schedules, practice records, random exam papers, question banks and bank questions, unprocessed recognition tasks and some profile data | Keeping personal data, importing supported fields |
| Question Exchange JSON (Export JSON) | Selected error item question content (question text, answer, analysis, knowledge points, difficulty, figures, optional original images) | Exchanging question content, cross-system import |
| Full-site file backup | The complete SQLite database, `config/`, deployment configuration and any certificates | Disaster recovery, moving the site, preparing a rollback before upgrades |

The JSON export does not include full user accounts with passwords, AI data sharing consent or the server AI configuration. Even when an admin exports all data, it does not replace a full-site backup.

## Web export and import

Export JSON from the data management section in the settings and keep it safe. When a regular user imports, the email in the export file normally must match the current account; a backup from another account can be merged into the current account after confirmation, with notebooks, tags, questions and exam papers all assigned to the current account and the other account's preferences not restored. Admins can import and export data for all users.

A full backup contains original question images (saved as WebP, or JPEG when the browser cannot encode WebP) and synthesized cloud voice clips, so a single file is commonly tens of MB. The web export is gzip-compressed JSON (still named `.json`); the web importer decompresses it automatically and still accepts older plain JSON. The importer checks the size before upload and accepts at most 256MB after decompression; larger files are reported before upload, and the server rejects oversized requests as well.

### Export JSON (Question Exchange Format)

The error list's multi-select bar provides an "Export JSON" feature that exports selected error items as a [Question Exchange JSON v1](https://github.com/margrop/wrong-notebook/blob/main/doc/QUESTION_FORMAT.en.md) file. Unlike a full backup, the exchange format contains only question content (question text, answer, analysis, knowledge points, difficulty, figures, etc.) and does not include practice records, review schedules, exam papers, user preferences, or other data.

- Only error items belonging to the current user are exported; ids not owned by the user are silently ignored.
- Optional "Include original images": when enabled, if the original image is a base64 inline image (PNG/JPEG/WebP), it is placed into the `images` field.
- Questions with empty question text are skipped and counted in `warnings` as `EMPTY_QUESTION_TEXT_SKIPPED`.
- The export result can be parsed directly by `parseQuestionFile`, achieving a round-trip.

### Full backup export

System and custom tags retain their tag system and parent-child hierarchy. Identically named chapters and knowledge points under different grades are restored separately, and questions reconnect to the specific nodes recorded in the backup. This includes Chinese grades, chapters, knowledge points and custom tags beneath them. Import supports older backups whose child nodes appear before their parents; repeating an import does not duplicate tags at the same path.

Question figures, GeoGebra demos, Chinese and English SVG animations with their synthesized cloud voice (MP3), the latest similar question and mastery probability are all restored from the export file; SVG is sanitized again on import, and questions without a mastery probability are re-evaluated after import. Exam papers are restored together with their questions and every recorded result; questions still being generated at export time show as failed after import and can be regenerated on the exam page. Importing your own export file also restores preferences such as the question grade rule and fixed grade, review before import, the duplicate threshold, GeoGebra demos, SVG animations and the interface theme.

Export files use version 14: `questionBanks` (banks and their questions) is new; tasks awaiting review and unfinished multi-question batches are no longer exported or imported, as they carry full-page images and continue processing only on the original device. These fields in older backups are ignored on import while the rest of the data is restored as before; importing never calls the AI.
Version 14 adds `questionBanks` with bank metadata and all questions; older backups without the field import as empty. Import deduplicates by original bank ID, appends "(imported)" to a conflicting name, and restores questions in bulk without affecting existing mistakes.

Version 7 adds an `extensions` namespace for fork projects to store private extension data (such as question-bank metadata). `extensions` is organized as `<key>: { version, data }`; each extension manages its own version. The upstream exports an empty object `{}` by default; on import, unregistered keys are safely skipped with a warning, and extensions newer than the running program are skipped as well. Fork projects can register extensions in the `BACKUP_EXTENSIONS` array in `src/lib/backup-extensions.ts`.

Version 8 adds a `mode` field to `examPapers` (`generate` for similar questions / `original` for original questions). Older files without this field import as `generate`.

Version 9 adds a `questionType` field to `errorItems` (question type such as single choice, fill in the blank, calculation, etc.). Older files without this field import as null.

Version 10 adds a `score` field to `examPapers.questions` (per-question score, up to one decimal place). Older files without this field import as no score set.

Version 11 adds a `groupByType` field to `examPapers` (whether questions are grouped into sections by question type) and a `questionType` field to `examPapers.questions` (the source question type snapshotted when the exam question was created). Older files without these fields import as false / null.

Import merges existing notebooks and tags and handles duplicates by question similarity. A duplicate may add another wrong attempt under the existing question, so importing the same file repeatedly can change the practice history.

Keep the original backup before importing, and afterwards check the new questions, tags, duplicate count and answer history. To restore to an exact point in time, use a file backup.

Restoring a backup keeps each question's original grade and does not apply the current entry rule. Old backups without a grade rule leave your current account settings unchanged.

Each mistake's and each exam question's figure display scale and alignment (left / center / right) are exported and restored for page display and printouts. Older backups with no scale or alignment, or an invalid value, use the default 100% and center.

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

## Unraid full-site backup and restore

On Unraid the container data lives in `/mnt/user/appdata/wrong-notebook` (`data/` and `config/`). The container environment variables (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`) are stored in Unraid's container configuration, not inside appdata, so record them separately when moving or recreating the container.
If the container name is not `wrong-notebook`, replace that name in the commands below with the actual one.

Stop the container before archiving so the SQLite data file, its WAL/SHM files and the configuration stay consistent:

```bash
appdata=/mnt/user/appdata/wrong-notebook
backups=/mnt/user/backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /mnt/user/appdata wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

When using the built-in HTTPS or additional certificate mounts, add those directories to the archive too. You can also use Unraid's **Appdata Backup** plugin: add `/mnt/user/appdata/wrong-notebook` to its backup set; the plugin stops the container before archiving. Restore with the plugin, or follow the manual steps below.

If the backup fails, do not continue with the upgrade; fix the cause and confirm the container is running again first. Archives may contain question images, user profiles, password hashes and AI credentials, so restrict access and keep them in a separate location.

Restore steps:

1. Confirm the backup time, source version and archive contents, and record the current container's Repository tag, port, path mappings and all environment variables.
2. Stop the container on the Docker page.
3. Move the current `/mnt/user/appdata/wrong-notebook` to a backup location, then unpack the archive into `/mnt/user/appdata`:

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /mnt/user/appdata
   ```

4. Keep the original container's path mappings and `NEXTAUTH_SECRET`, and prefer the image version that matches the backup. After starting, sign in and check users, questions, tags, answer history and exam papers.
5. When an upgrade is needed, run the [upgrade steps](Deployment-en#unraid-docker-ui) separately after the restore has been verified.

Do not switch an old database back and forth between incompatible versions. If the restored container does not match the backup version, verify the data first, then switch images following the upgrade steps.

## Synology Container Manager full-site backup and restore

The data directory is `/volume1/docker/wrong-notebook` (`data/` and `config/`); container environment variables are stored in Container Manager's container configuration, so record them separately when moving or recreating the container. If the container name is not `wrong-notebook`, replace that name in the commands.

Stop the container before archiving:

```bash
appdata=/volume1/docker/wrong-notebook
backups=/volume1/backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /volume1/docker wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

You can also use DSM's **Hyper Backup**: add `/volume1/docker/wrong-notebook` to a backup task and stop the container before the task runs; restore with Hyper Backup, or follow the manual steps below. Archives may contain question images, user profiles, password hashes and AI credentials, so restrict access and keep them in a separate location.

Restore:

1. Record the current container's image tag, port, volume mappings and all environment variables.
2. Stop the container in Container Manager.
3. Move the current `/volume1/docker/wrong-notebook` to a backup location, then unpack the archive into `/volume1/docker`:

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /volume1/docker
   ```

4. Keep the original container's volume mappings and `NEXTAUTH_SECRET`, and prefer the image version that matches the backup. After starting, sign in and check users, questions, tags, answer history and exam papers.
5. When an upgrade is needed, run the [upgrade steps](Deployment-en#synology-dsm-container-manager) separately after the restore has been verified.

## QNAP Container Station full-site backup and restore

The data directory is `/share/Container/wrong-notebook` (`data/` and `config/`); container environment variables are stored in Container Station's container configuration, so record them separately when moving or recreating the container. If the container name is not `wrong-notebook`, replace that name in the commands.

Stop the container before archiving:

```bash
appdata=/share/Container/wrong-notebook
backups=/share/Backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /share/Container wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

You can also use QNAP's **Hybrid Backup Sync**: add `/share/Container/wrong-notebook` to a backup task and stop the container before the task runs; restore with Hybrid Backup Sync, or follow the manual steps below. Archives may contain question images, user profiles, password hashes and AI credentials, so restrict access and keep them in a separate location.

Restore:

1. Record the current container's image tag, port, volume mappings and all environment variables.
2. Stop the container in Container Station.
3. Move the current `/share/Container/wrong-notebook` to a backup location, then unpack the archive into `/share/Container`:

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /share/Container
   ```

4. Keep the original container's volume mappings and `NEXTAUTH_SECRET`, and prefer the image version that matches the backup. After starting, sign in and check users, questions, tags, answer history and exam papers.
5. When an upgrade is needed, run the [upgrade steps](Deployment-en#qnap-qts-container-station) separately after the restore has been verified.



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
