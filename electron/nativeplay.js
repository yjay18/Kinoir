/* Native playback for local files. Prefer an optional managed IINA pack or the
   user's installed IINA instead of making the core application carry a second app. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

function resolvePlayer(resourcesDir, packsRoot) {
  const iina = firstExisting([
    packsRoot && path.join(packsRoot, 'iina', 'current', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    '/Applications/IINA.app/Contents/MacOS/iina-cli',
    resourcesDir && path.join(resourcesDir, 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    path.join(__dirname, '..', 'build', 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli')
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
function playNative(filePath, resourcesDir, packsRoot, title, playlist, pip) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('file not found');
  const player = resolvePlayer(resourcesDir, packsRoot);
  if (!player) throw new Error('IINA is not installed');
  const appPath = player.bin.replace('/Contents/MacOS/iina-cli', '');
  launch('open', ['-a', appPath, filePath]);
  return player.kind;
}

// Compatibility route for the old "open externally" button. It deliberately uses
// the same IINA-only path now, never Finder's/LaunchServices' default application.
function openExternal(filePath, resourcesDir = process.resourcesPath, packsRoot) {
  return playNative(filePath, resourcesDir, packsRoot);
}

module.exports = { resolvePlayer, playNative, openExternal };
