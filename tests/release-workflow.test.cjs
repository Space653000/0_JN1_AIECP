'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const count = (text, pattern) => (text.match(pattern) || []).length;

function topLevelJobIds(workflow) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'jobs:');
  if (start < 0) return [];
  return lines.slice(start + 1)
    .map((line) => line.match(/^  ([A-Za-z0-9_-]+):$/)?.[1] || null)
    .filter(Boolean);
}

test('release workflow is structurally unique and gated by real smoke evidence', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /pull_request:[\s\S]*branches:\s*\[main\]/);
  assert.match(workflow, /pull_request\.head\.sha \|\| github\.sha/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /verify:[\s\S]*timeout-minutes:\s*45/);
  assert.match(workflow, /provenance:[\s\S]*timeout-minutes:\s*45/);

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
  assert.match(workflow, /\$sourceCommit = \(git rev-parse HEAD\)\.Trim\(\)/);
  assert.match(workflow, /sourceCommit=\$sourceCommit/);
  assert.doesNotMatch(workflow, /sourceCommit=\$env:GITHUB_SHA/);
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
  assert.match(store, /p\.build\.appx\.identityName=process\.env\.AECP_STORE_IDENTITY/);
  assert.match(store, /npm run dist:store:x64/);
  assert.match(store, /npm run dist:store:arm64/);
  assert.doesNotMatch(store, /-c\.appx\./);
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


test('signed release lane is owner-gated and verifies Authenticode provenance', () => {
  const workflow = read('.github/workflows/signed-release.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /signer_thumbprint:/);
  assert.match(workflow, /publish_ack:/);
  assert.match(workflow, /secrets\.AECP_CODESIGN_PFX_BASE64/);
  assert.match(workflow, /secrets\.AECP_CODESIGN_PASSWORD/);
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /Signer thumbprint mismatch/);
  assert.match(workflow, /aecp\.authenticode-evidence\/v1/);
  assert.match(workflow, /aecp\.signed-release-provenance\/v1/);
  assert.equal(count(workflow, /^  signed-provenance:$/gm), 1);
  assert.equal(count(workflow, /^  publish-signed-release:$/gm), 1);
  assert.equal(workflow.includes("$sourceCommit -notmatch '^[0-9a-f]{40}$'"), true);
  assert.match(workflow, /sourceCommit=\$sourceCommit/);
  assert.doesNotMatch(workflow, /sourceCommit=\$env:GITHUB_SHA/);
  assert.match(workflow, /if:\s*\$\{\{ inputs\.publish_ack \}\}/);
  assert.doesNotMatch(workflow, /BEGIN (?:RSA )?PRIVATE KEY|BEGIN CERTIFICATE/);
});

test('updater supports build-time signer pinning without forcing unsigned preview builds', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(typeof pkg.aecp.requiredSignerThumbprint, 'string');
  const main = read('electron/main.cjs');
  assert.match(main, /const UPDATE_REPO = 'Space653000\/0_JN1_AIECP';/);
  assert.doesNotMatch(main, /Space653000\/AI-Engineering-Control-Plane/);
  assert.match(main, /verifyAuthenticode/);
  assert.match(main, /AECP_REQUIRED_SIGNER_THUMBPRINT/);
  assert.match(main, /packageManifest\?\.aecp\?\.requiredSignerThumbprint/);
  assert.match(main, /rollbackInstaller[\s\S]*verifyAuthenticode/);
});

test('all GitHub workflows have unique top-level job ids', () => {
  const dir = path.join(root, '.github', 'workflows');
  for (const name of fs.readdirSync(dir).filter((item) => /\.ya?ml$/i.test(item))) {
    const workflow = fs.readFileSync(path.join(dir, name), 'utf8');
    const ids = topLevelJobIds(workflow);
    assert.equal(ids.length, new Set(ids).size, name + ' contains duplicate top-level job ids');
  }
});


test('installer explicitly preserves AECP user data on uninstall', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
});
