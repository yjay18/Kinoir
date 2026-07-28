'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  isLoopbackAddress,
  localAvailability,
  sameOrigin,
  sanitizeLibrary,
  saveLibrary,
  trustedHost
} = require('../electron/server');

test('loopback detection accepts local addresses only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
});

test('same-origin POST validation rejects an unrelated website', () => {
  const request = (origin, address = '127.0.0.1') => ({
    headers: { origin, host: '127.0.0.1:4174' },
    socket: { remoteAddress: address }
  });
  assert.equal(sameOrigin(request('http://127.0.0.1:4174')), true);
  assert.equal(sameOrigin(request('https://example.com')), false);
  assert.equal(sameOrigin(request(undefined)), true);
  assert.equal(sameOrigin(request(undefined, '192.168.1.20')), false);
});

test('server host validation blocks DNS rebinding hostnames', () => {
  const request = host => ({ headers: { host } });
  assert.equal(trustedHost(request('127.0.0.1:4174')), true);
  assert.equal(trustedHost(request('192.168.1.8:4174')), true);
  assert.equal(trustedHost(request('localhost:4174')), true);
  assert.equal(trustedHost(request('attacker.example:4174')), false);
});

test('Air library payloads remove paths but preserve availability', () => {
  const result = sanitizeLibrary({ library: [{
    id: 'movie', localPath: '/Users/example/Movie.mkv',
    seasons: [{ episodes: [{ localPath: '/private/episode.mkv' }] }]
  }] });
  assert.equal(JSON.stringify(result).includes('/Users/'), false);
  assert.equal(result.library[0].localAvailable, true);
  assert.equal(result.library[0].seasons[0].episodes[0].localAvailable, true);
});

test('library saves atomically and availability distinguishes stale files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinoir-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const media = path.join(root, 'movie.mp4');
  await fs.writeFile(media, 'fixture');
  await saveLibrary(root, { library: [
    { id: 'ready', type: 'movie', localPath: media },
    { id: 'missing', type: 'movie', localPath: path.join(root, 'gone.mp4') }
  ] });
  const saved = JSON.parse(await fs.readFile(path.join(root, 'library', 'library.json'), 'utf8'));
  assert.equal(saved.library.length, 2);
  const status = await localAvailability(root);
  assert.deepEqual(status.ids, ['ready']);
  assert.deepEqual(status.missingIds, ['missing']);
  assert.deepEqual(status.availableKeys, ['ready/0/0']);
  assert.deepEqual(status.missingKeys, ['missing/0/0']);
});
