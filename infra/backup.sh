#!/bin/sh
# The writer's nightly backup: a pg_dump of the writer schema, encrypted with age to breader's
# backup key (BACKUP_RECIPIENT), kept here for 14 days and sent to breader's R2 backup bucket
# under writer/. Breader's own backup dumps the laptop's copy, which has none of our tables.
# The compose backup service runs it with no arguments, checking every 10 minutes.
#   sh infra/backup.sh        check every 10 minutes, and back up once a night after 03:00 (TZ)
#   sh infra/backup.sh due    back up now if tonight's isn't done
#   sh infra/backup.sh now    back up now, in place of today's if there is one
# A backup goes into place only once R2 has it, so a failed upload is tried again at the next check.
# Restore: age -d -i key.txt writer-DATE.dump.age | pg_restore --clean --if-exists --no-owner -d <url>
set -eu
set -o pipefail

DIR=/data/backups
KEEP=14

# R2, as rclone's remote r2, from the settings breader's backup uses.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="${S3_ENDPOINT:-}"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}"
# The key may write to the bucket without being allowed to make or list buckets.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

say() {
  echo "$(date '+%F %T') $*"
}

# R2's lifecycle rules keep writer/daily/ for 7 days and writer/weekly/ (Sundays) for 28.
upload() {
  file=$1
  name=$2
  if [ -z "${S3_BACKUP_BUCKET:-}" ]; then
    say "S3_BACKUP_BUCKET is unset, so $name stays on this machine only"
    return
  fi
  rclone copyto "$file" "r2:$S3_BACKUP_BUCKET/writer/daily/$name"
  if [ "$(date +%u)" = 7 ]; then
    rclone copyto "$file" "r2:$S3_BACKUP_BUCKET/writer/weekly/$name"
  fi
}

# Only the newest 14 stay here.
prune() {
  count=$(ls "$DIR" | grep -c '^writer-.*\.dump\.age$' || true)
  extra=$((count - KEEP))
  if [ "$extra" -le 0 ]; then
    return
  fi
  ls "$DIR" | grep '^writer-.*\.dump\.age$' | sort | head -n "$extra" | while read -r old; do
    rm -f "$DIR/$old"
  done
}

backup() {
  name="writer-$(date +%F).dump.age"
  part="$DIR/$name.part"
  pg_dump --schema=writer --format=custom --no-owner --no-privileges "$DATABASE_URL" | age -r "$BACKUP_RECIPIENT" > "$part"
  upload "$part" "$name"
  mv "$part" "$DIR/$name"
  prune
  say "backed up $name ($(wc -c < "$DIR/$name") bytes)"
}

# Tonight's, once it's past 03:00 and it isn't there yet.
due() {
  hour=$(date +%H)
  hour=${hour#0}
  if [ "$hour" -lt 3 ]; then
    return
  fi
  if [ -e "$DIR/writer-$(date +%F).dump.age" ]; then
    return
  fi
  backup
}

if [ -z "${BACKUP_RECIPIENT:-}" ]; then
  say "BACKUP_RECIPIENT is unset, so there are no backups"
  if [ -n "${1:-}" ]; then
    exit 1
  fi
  # Idle rather than exit, or compose would start it again and again.
  while true; do
    sleep 86400
  done
fi

case "${1:-}" in
  now) backup ;;
  due) due ;;
  *)
    say "backing up the writer schema nightly after 03:00"
    while true; do
      # Its own shell, so a failure stops the backup it's in and not the checks.
      sh "$0" due || say "the backup failed, trying again at the next check"
      sleep 600
    done ;;
esac
