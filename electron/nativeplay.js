/* Native playback for local files. Always target Linkflix's bundled IINA (with an
   installed IINA as a development fallback) instead of asking macOS to choose an
   opener, which can otherwise send MP4/MOV files to QuickTime. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

// Prefer the packaged resource, then the checked-out development bundle. A system
// IINA is only a last-resort development fallback; local files never go through the
// macOS default-file-association path.
function resolvePlayer(resourcesDir) {
  const iina = firstExisting([
    resourcesDir && path.join(resourcesDir, 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    path.join(__dirname, '..', 'build', 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    '/Applications/IINA.app/Contents/MacOS/iina-cli'
  ]);
  if (iina) return { kind: 'iina', bin: iina };
  return null;
}

function launch(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => { /* surfaced to caller via existence checks */ });
  child.unref();
}

// Play in IINA. Returns the player kind used.
// playlist: optional array of additional file paths
function playNative(filePath, resourcesDir, title, playlist, pip) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('file not found');
  const player = resolvePlayer(resourcesDir);
  if (!player) throw new Error('bundled IINA not found');
  const appPath = player.bin.replace('/Contents/MacOS/iina-cli', '');
  launch('open', ['-a', appPath, filePath]);
  return player.kind;
}

// Compatibility route for the old "open externally" button. It deliberately uses
// the same IINA-only path now, never Finder's/LaunchServices' default application.
function openExternal(filePath, resourcesDir = process.resourcesPath) {
  return playNative(filePath, resourcesDir);
}

module.exports = { resolvePlayer, playNative, openExternal };
