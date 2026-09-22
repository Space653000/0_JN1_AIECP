'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const count = (text, pattern) => (text.match(pattern) || []).length;

test('release workflow is structurally unique and gated by real smoke evidence', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /pull_request:[\s\S]*branches:\s*\[main\]/);
  assert.match(workflow, /pull_request\.head\.sha \|\| github\.sha/);
  assert.match(workflow, /cancel-in-progress:\s*true/);

  for (const job of [
    'verify',
    'build-fallback',
    'smoke-install',
    'build-auto',
    'build-universal',
    'smoke-universal',
    'build-store-test',
    'package-upgrade-baseline',
    'smoke-upgrade-rollback',
    'provenance',
    'publish-release'
  ]) {
    assert.equal(count(workflow, new RegExp('^  ' + job + ':$', 'gm')), 1, job + ' must appear exactly once');
  }

  assert.match(workflow, /build-universal:\r?\n\s+name:[\s\S]*?needs:\s+build-fallback/);
  assert.match(workflow, /smoke-install:[\s\S]*windows-11-arm/);
  assert.match(workflow, /smoke-universal:[\s\S]*windows-11-arm/);
  assert.match(workflow, /smoke-upgrade-rollback:[\s\S]*windows-11-arm/);
  assert.match(workflow, /build-store-test:[\s\S]*dist:store:x64[\s\S]*dist:store:arm64/);
  assert.match(workflow, /validate-store-package\.ps1/);
  assert.match(workflow, /provenance:[\s\S]*aecp\.release-provenance\/v1/);
  assert.match(workflow, /sourceCommit=\$env:GITHUB_SHA/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /Get-FileHash[^\n\r]*SHA256/);
  assert.match(workflow, /publish-release:\r?\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)\r?\n\s+needs:\s+provenance/);
  assert.doesNotMatch(workflow, /build-universal:[\s\S]*?build-universal:/);
  assert.doesNotMatch(workflow, /smoke-universal:[\s\S]*?smoke-universal:/);
});

test('universal bootstrap embeds both architecture payloads', () => {
  const project = read('release/universal-bootstrap/UniversalBootstrap.csproj');
  assert.match(project, /payloads\/AI-Engineering-Control-Plane-Setup-x64\.exe/);
  assert.match(project, /payloads\/AI-Engineering-Control-Plane-Setup-arm64\.exe/);
  const program = read('release/universal-bootstrap/Program.cs');
  assert.match(program, /Architecture\.X64/);
  assert.match(program, /Architecture\.Arm64/);
  assert.match(program, /EndsWith\(payload/);
});

test('Store packaging is repository-verifiable but submission remains owner-gated', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.appx.applicationId, 'AECP');
  assert.equal(pkg.build.appx.identityName, 'Space653000.AECPPreview');
  assert.deepEqual(pkg.build.appx.languages, ['en-US', 'zh-TW']);
  assert.match(pkg.scripts['dist:store:x64'], /--win appx --x64/);
  assert.match(pkg.scripts['dist:store:arm64'], /--win appx --arm64/);

  const packaging = read('.github/workflows/ci.yml');
  assert.match(packaging, /package-store:/);
  assert.match(packaging, /Validate Store package manifest/);
  assert.match(packaging, /smoke-upgrade-rollback:/);
  assert.match(packaging, /0\.2\.99/);
  assert.match(packaging, /--config\.directories\.output=release\/upgrade-baseline/);
  assert.doesNotMatch(packaging, /-c\.directories\.output=/);

  const store = read('.github/workflows/store-package.yml');
  assert.match(store, /identity_name:/);
  assert.match(store, /publisher:/);
  assert.match(store, /private_audience_ack:/);
  assert.match(store, /ExpectedPublisher/);
  assert.match(store, /submittedToPartnerCenter=\$false/);
  assert.doesNotMatch(store, /PartnerCenter\\.|Submit-ToStore|StoreBroker|winget submit/i);
});

test('Store package validator requires identity, architecture, publisher and runFullTrust', () => {
  const validator = read('scripts/validate-store-package.ps1');
  assert.match(validator, /ExpectedArchitecture/);
  assert.match(validator, /ExpectedIdentityName/);
  assert.match(validator, /ExpectedPublisher/);
  assert.match(validator, /ProcessorArchitecture/);
  assert.match(validator, /runFullTrust/);
  assert.match(validator, /Get-FileHash.*SHA256/);
});
