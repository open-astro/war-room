#!/usr/bin/env bash
# Installs a launchd agent that dispatches the collect workflow every hour at
# :05 via `gh workflow run`. This is a backstop for GitHub's best-effort cron,
# which frequently skips scheduled slots. Requires `gh auth login` on this Mac.
# Uninstall: launchctl bootout gui/$(id -u)/com.war-room.collect && rm ~/Library/LaunchAgents/com.war-room.collect.plist
set -euo pipefail

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
GH="$(command -v gh)"
LABEL=com.war-room.collect
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/war-room-collect.log"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$GH</string>
    <string>workflow</string>
    <string>run</string>
    <string>collect.yml</string>
    <string>--repo</string>
    <string>$REPO</string>
    <string>--ref</string>
    <string>main</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Minute</key><integer>5</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: dispatches $REPO collect.yml hourly at :05. Log: $LOG"
