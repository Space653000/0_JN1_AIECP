'use strict';

// Fixed local CLI worker for the real-provider evidence lane (local-command mode).
// Deterministically echoes the bounded prompt text back to stdout so the
// provider-environment evidence script can prove real process execution
// without model credentials or network access.
process.stdout.write(process.argv.slice(2).join(' '));
process.exit(0);
