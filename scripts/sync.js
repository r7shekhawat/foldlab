#!/usr/bin/env node
// Copies the shared core and the web playground into the extension so it can ship them,
// and keeps the extension version in step with package.json.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'extension', 'playground');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, 'core'), path.join(dest, 'core'), { recursive: true });
fs.cpSync(path.join(root, 'web'), path.join(dest, 'web'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifestPath = path.join(root, 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

console.log('Synced core + web into extension/playground (v' + pkg.version + ')');
