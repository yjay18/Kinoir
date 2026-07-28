#!/bin/bash
set -e

echo "Installing the optional Ollama pack..."

DEFAULT_PACKS_ROOT="$HOME/Library/Application Support/Kinoir/packs"
LEGACY_PACKS_ROOT="$HOME/Library/Application Support/Linkflix/packs"
if [ -d "$LEGACY_PACKS_ROOT" ] && [ ! -d "$DEFAULT_PACKS_ROOT" ]; then
  DEFAULT_PACKS_ROOT="$LEGACY_PACKS_ROOT"
fi
PACKS_ROOT="${KINOIR_PACKS_ROOT:-${LINKFLIX_PACKS_ROOT:-$DEFAULT_PACKS_ROOT}}"
TARGET_DIR="$PACKS_ROOT/ollama/current"
mkdir -p "$(dirname "$TARGET_DIR")"

if [ -x "$TARGET_DIR/ollama" ]; then
    echo "Ollama pack already exists at $TARGET_DIR."
    exit 0
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
echo "Downloading Ollama-darwin.zip..."
curl -L -s "https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip" -o "$TMP_DIR/Ollama-darwin.zip"

echo "Unzipping..."
unzip -q "$TMP_DIR/Ollama-darwin.zip" -d "$TMP_DIR"

echo "Extracting binary and dependencies..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$TMP_DIR/Ollama.app/Contents/Resources/." "$TARGET_DIR/"
chmod +x "$TARGET_DIR/ollama"
if [ -f "$TARGET_DIR/llama-server" ]; then chmod +x "$TARGET_DIR/llama-server"; fi

echo "Ollama pack installed at $TARGET_DIR"
