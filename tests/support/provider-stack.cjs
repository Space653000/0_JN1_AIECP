'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { ok, reviewJson, reviewIds } = require('./e2e-fixtures.cjs');

const API_KEY = 'stack-secret-key-0123456789ABCDEF';
const MISSION_TASKS = [{ title: 'Provider swap task', objective: 'Create the output file', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' }];
const TASK_PLAN = { tasks: [{ task_id: 'T1', title: 'Provider swap task', objective: 'Create the output file', acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] };

const shapeOf = (value) => {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
  return 'value';
};

// A minimal OpenAI-compatible endpoint answering planner and reviewer prompts.
async function startEndpoint() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
      const prompt = JSON.parse(body).messages[0].content;
      requests.push({ url: req.url, prompt, authorization: req.headers.authorization });
      let content;
      if (prompt.startsWith('You are the AECP Mission Planner')) content = JSON.stringify({ tasks: MISSION_TASKS });
      else if (prompt.startsWith('You are the AECP Planner')) content = JSON.stringify(TASK_PLAN);
      else content = reviewJson(reviewIds(prompt));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { requests, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

// Emulates the command line tools at the process boundary; the ProviderRouter above it is the real one.
function makeCliRunner(log, { failFor = new Set(), missionTasks = MISSION_TASKS } = {}) {
  return async (command, args, opts = {}) => {
    const base = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    log.push({ base, args: [...args], cwd: opts.cwd, env: opts.env });
    if (base === 'where' || base === 'which') return ok(`C:\\tools\\${args[0]}`);
    if (args.includes('--version')) return ok(`${base} 1.2.3`);
    if (base === 'node' && args[0] !== 'worker.cjs') return { code: 1, stdout: '', stderr: 'the registered local command lost its fixed arguments', timedOut: false, aborted: false };
    if (failFor.has(base)) return { code: 1, stdout: '', stderr: `${base} failed`, timedOut: false, aborted: false };
    const prompt = args.find((arg) => typeof arg === 'string' && arg.startsWith('You are the AECP')) || '';
    const wrap = (text) => ok(base === 'claude' ? JSON.stringify({ type: 'result', result: text }) : text);
    if (prompt.startsWith('You are the AECP Mission Planner')) return wrap(JSON.stringify({ tasks: missionTasks }));
    if (prompt.startsWith('You are the AECP Planner')) return wrap(JSON.stringify(TASK_PLAN));
    if (prompt.startsWith('You are the AECP Builder')) { await fs.writeFile(path.join(opts.cwd, `built-by-${base}.txt`), 'work\n'); return ok('builder done'); }
    if (prompt.startsWith('You are the AECP Reviewer')) return wrap(reviewJson(reviewIds(prompt)));
    return { code: 1, stdout: '', stderr: `unexpected invocation of ${base}`, timedOut: false, aborted: false };
  };
}

module.exports = { API_KEY, MISSION_TASKS, TASK_PLAN, shapeOf, startEndpoint, makeCliRunner };
