'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('release workflow has valid universal-build dependency references', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /build-universal:\r?\n\s+needs:\s+\[build-fallback\]/);
  assert.match(workflow, /smoke-install:[\s\S]*windows-11-arm/);
  assert.match(workflow, /smoke-universal:[\s\S]*windows-11-arm/);
  assert.match(workflow, /publish-release:\r?\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)\r?\n\s+needs:\s+\[build-fallback, build-auto, build-universal, smoke-install, smoke-universal\]/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /Get-FileHash[^\n\r]*SHA256/);
  assert.doesNotMatch(workflow, /needs:\s*\[[^\]]*build-x64[^\]]*\]/);
  assert.doesNotMatch(workflow, /needs:\s*\[[^\]]*build-arm64[^\]]*\]/);
});

test('universal bootstrap embeds both architecture payloads', () => {
  const project = fs.readFileSync(path.join(root, 'release/universal-bootstrap/UniversalBootstrap.csproj'), 'utf8');
  assert.match(project, /payloads\/AI-Engineering-Control-Plane-Setup-x64\.exe/);
  assert.match(project, /payloads\/AI-Engineering-Control-Plane-Setup-arm64\.exe/);
  const program = fs.readFileSync(path.join(root, 'release/universal-bootstrap/Program.cs'), 'utf8');
  assert.match(program, /Architecture\.X64/);
  assert.match(program, /Architecture\.Arm64/);
  assert.match(program, /EndsWith\(payload/);
});
