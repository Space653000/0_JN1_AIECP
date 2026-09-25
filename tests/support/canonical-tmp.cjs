'use strict';

// Preloaded by `npm test` (node --require) so every test process sees a canonical temp folder.
//
// GitHub's Windows runners report the temp folder as an 8.3 short path (C:\Users\RUNNER~1\...) while `git worktree`,
// realpath and friends return the long form. AECP's SecurityPolicy compares paths textually and fails closed, so a
// Mission whose runtime folder is spelled differently from the worktree Git reports is refused ("Path is outside the
// configured allowlist"). That is a real product robustness gap (recorded in .ai/GAP_REGISTER.md), not something the
// tests should depend on: the fixtures only need a temp folder, so they are given its canonical spelling.
const fs = require('node:fs');
const os = require('node:os');

try {
  const spelled = os.tmpdir();
  const canonical = fs.realpathSync.native(spelled);
  if (canonical && canonical !== spelled) {
    if (process.platform === 'win32') { process.env.TMP = canonical; process.env.TEMP = canonical; }
    else process.env.TMPDIR = canonical;
  }
} catch { /* keep whatever the platform gave us */ }
