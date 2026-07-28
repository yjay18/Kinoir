#!/bin/bash
# Install IINA as an optional Kinoir-managed pack.
set -e

cd "$(dirname "$0")/.."
DEFAULT_PACKS_ROOT="$HOME/Library/Application Support/Kinoir/packs"
LEGACY_PACKS_ROOT="$HOME/Library/Application Support/Linkflix/packs"
if [ -d "$LEGACY_PACKS_ROOT" ] && [ ! -d "$DEFAULT_PACKS_ROOT" ]; then
  DEFAULT_PACKS_ROOT="$LEGACY_PACKS_ROOT"
fi
PACKS_ROOT="${KINOIR_PACKS_ROOT:-${LINKFLIX_PACKS_ROOT:-$DEFAULT_PACKS_ROOT}}"
TARGET_DIR="$PACKS_ROOT/iina/current"

echo "Fetching latest IINA release info..."
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/iina/iina/releases/latest | grep browser_download_url | cut -d '"' -f 4 | grep '.dmg$')

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Failed to find IINA DMG url!"
  exit 1
fi

echo "Downloading IINA from $DOWNLOAD_URL..."
TMP_DIR=$(mktemp -d)
trap 'hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP_DIR"' EXIT
TMP_DMG="$TMP_DIR/IINA_download.dmg"
curl -L -o "$TMP_DMG" "$DOWNLOAD_URL"

echo "Mounting DMG..."
MOUNT_POINT=$(hdiutil attach "$TMP_DMG" -nobrowse -noverify -noautoopen | grep /Volumes | awk '{print $3}')

if [ -z "$MOUNT_POINT" ]; then
  echo "Failed to mount DMG!"
  exit 1
fi

echo "Copying IINA.app to the optional packs folder..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$MOUNT_POINT/IINA.app" "$TARGET_DIR/IINA.app"

echo "Unmounting DMG..."
hdiutil detach "$MOUNT_POINT" -quiet

echo "IINA pack installed at $TARGET_DIR/IINA.app ($(du -sh "$TARGET_DIR/IINA.app" | cut -f1))"
