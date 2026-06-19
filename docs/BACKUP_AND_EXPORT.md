# FREEOS Backup and Export

FREEOS creates timestamped backups in `exports/backups/YYYY-MM-DD_HH-mm-ss/`. Backups never overwrite or delete an existing backup.

By default a backup includes `data/freeos.sqlite`, `data/projects/`, `docs/`, and `backup-manifest.json`. Logs are opt-in through the Command Center API and dashboard.

FREEOS excludes `.env` files, `node_modules`, local model files, the large whisper.cpp source/model areas, and generated voice audio. Do not add secrets to backup folders.

## Restore manually

1. Stop the FREEOS API.
2. Make a safety copy of the current `data/` folder.
3. Copy the backed-up `freeos.sqlite` to `data/freeos.sqlite` and the backed-up `projects/` contents to `data/projects/`.
4. Copy documentation only if desired, then restart FREEOS and run the status checks.

On an external drive, wait for writes to finish and eject the drive safely. A backup on the same physical drive is useful for export, but not protection from drive failure.
