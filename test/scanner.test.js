'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVideo } = require('../electron/scanner');

test('scanner parses a conventional TV episode filename', () => {
  const item = parseVideo('/media/The.Show.S02E03.1080p.mkv', '/media');
  assert.equal(item.kind, 'episode');
  assert.equal(item.show, 'The Show');
  assert.equal(item.season, 2);
  assert.equal(item.episode, 3);
});

test('scanner removes release noise while preserving movie year', () => {
  const item = parseVideo('/media/Movies/Arrival.2016.2160p.BluRay.x265.mkv', '/media');
  assert.equal(item.kind, 'movie');
  assert.equal(item.title, 'Arrival');
  assert.equal(item.year, '2016');
});
