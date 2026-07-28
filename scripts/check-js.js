#!/usr/bin/env node
'use strict';

const { readdirSync, statSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const roots = ['electron', 'js', 'scripts'];
const skip = new Set(['js/vendor']);
const files = [];

function walk(dir) {
  if (skip.has(dir)) return;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (file.endsWith('.js')) files.push(file);
  }
}

roots.forEach(walk);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Checked ${files.length} JavaScript files.`);
