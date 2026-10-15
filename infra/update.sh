#!/bin/sh
# Keeps the writer on the laptop on its latest server image, checking every 5 minutes: a LaunchAgent
# on a Mac, a systemd user timer on Linux. A copy of breader's infra/update.sh, for the writer's stack.
#   infra/update.sh --install     start checking
#   infra/update.sh --uninstall   stop checking
#   infra/update.sh               check once now
# It pulls the image and restarts the stack only when the running API is on an older one, so a
# stack you stopped yourself stays stopped. Migrations run first (the migrate service); if they
# fail, the old version keeps running and the next check tries again.
set -eu
cd "$(dirname "$0")"
DIR=$(pwd)
LABEL=example.breader-writer.update
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT=breader-writer-update

launchd() {
  case "$1" in
    --install)
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$DIR/update.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HOME/.docker/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$DIR/update.log</string>
  <key>StandardErrorPath</key><string>$DIR/update.log</string>
</dict></plist>
EOF
      launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST" ;;
    --uninstall)
      launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
      rm -f "$PLIST" ;;
  esac
}

systemd() {
  case "$1" in
    --install)
      mkdir -p "$UNITS"
      cat > "$UNITS/$UNIT.service" <<EOF
[Unit]
Description=Update the writer stack to the latest server image

[Service]
Type=oneshot
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/sh "$DIR/update.sh"
StandardOutput=append:$DIR/update.log
StandardError=append:$DIR/update.log
EOF
      cat > "$UNITS/$UNIT.timer" <<EOF
[Unit]
Description=Check for a new writer server image every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now "$UNIT.timer"
      # Without lingering, a user's timers only run while they're logged in.
      loginctl enable-linger "$(id -un)" 2>/dev/null ||
        echo "Also run: sudo loginctl enable-linger $(id -un)   (so checks run before you log in)" ;;
    --uninstall)
      systemctl --user disable --now "$UNIT.timer" 2>/dev/null || true
      rm -f "$UNITS/$UNIT.service" "$UNITS/$UNIT.timer"
      systemctl --user daemon-reload ;;
  esac
}

case "${1:-}" in
  --install|--uninstall)
    case "$(uname -s)" in
      Darwin) launchd "$1" ;;
      Linux) systemd "$1" ;;
      *) echo "update.sh: no scheduler for $(uname -s); run it from cron every 5 minutes." >&2; exit 1 ;;
    esac
    if [ "$1" = --install ]; then echo "Checking for new images every 5 minutes. Log: $DIR/update.log"
    else echo "Stopped checking for new images."; fi
    exit 0 ;;
esac

compose() { docker compose -f compose.yml "$@"; }
docker info >/dev/null 2>&1 || exit 0 # Docker isn't running yet
IMAGE=$(sed -n 's/^IMAGE=//p' .env)

compose pull --quiet writer-api
want=$(docker image inspect --format '{{.Id}}' "$IMAGE")
running=$(compose ps --quiet writer-api) # running only
have=$(test -n "$running" && docker inspect --format '{{.Image}}' "$running" || true)

if [ -n "$running" ] && [ "$want" != "$have" ]; then
  echo "$(date '+%F %T') updating to $want"
  compose pull --quiet
  compose up -d --remove-orphans
  docker image prune -f >/dev/null
fi
