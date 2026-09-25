'use strict';

// One "process lifetime" of the real electron/main.cjs against a fake Electron, sharing a userData folder with
// other lifetimes. Usage: node main-session.cjs <userData> <workspace> <import|execute|fail|trace> [taskId]
// Prints one JSON line with the result, so a test can restart the app by running this again.
const { loadMain } = require('./fake-electron-main.cjs');

(async () => {
  const [userData, workspace, action, taskId] = process.argv.slice(2);
  // AECP_FAKE_VERSION / AECP_FAKE_UPDATE_CHANNEL let a test restart the app as another version, with a scripted release channel.
let fakeChannel = null;
if (process.env.AECP_FAKE_UPDATE_CHANNEL) fakeChannel = require('./update-channel-fake.cjs').install({ mode: process.env.AECP_FAKE_UPDATE_CHANNEL });
const ctx = loadMain({ userData, version: process.env.AECP_FAKE_VERSION || undefined });
  await ctx.start();
  const call = (channel, payload) => ctx.handlers[channel]({}, payload);
  let out;
  if (action === 'import') {
    ctx.control.chosenFolder = workspace;
    await call('workspace:select');
    const card = await call('task:sample');
    out = (await call('task:import', { text: JSON.stringify(card) })).id;
  } else if (action === 'import-git-status') {
    const card = { schema: 'aecp.task/v1', title: 'Status', goal: 'Read the git status', action: { type: 'git-status' }, permissions: ['workspace:read'] };
    out = (await call('task:import', { text: JSON.stringify(card) })).id;
  } else if (action === 'update-status') out = await call('update:status');
  else if (action === 'update-rollback') { try { out = { result: await call('update:rollback') }; } catch (error) { out = { error: error.message }; } out.spawned = fakeChannel ? fakeChannel.record.spawned : []; }
  else if (action === 'execute') out = await call('task:execute', { taskId });
  else if (action === 'trace') out = await call('task:trace', { taskId });
  process.stdout.write(`\nRESULT ${JSON.stringify(out)}\n`);
  process.exit(0);
})().catch((error) => { process.stderr.write(String(error?.stack || error)); process.exit(1); });
