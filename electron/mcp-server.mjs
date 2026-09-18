import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const execFile = promisify(execFileCb);
const MAX_TEXT_BYTES = 256 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function resolveInside(root, relativePath) {
  const relative = String(relativePath || '').trim();
  if (!relative || path.isAbsolute(relative)) throw new Error('Path must be relative to the active Workspace.');
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, relative);
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate !== rootResolved && !candidate.startsWith(rootPrefix)) {
    throw new Error('Path escapes the active Workspace.');
  }
  return candidate;
}

async function gitStatus(workspaceRoot) {
  try {
    const top = (await execFile('git', ['rev-parse', '--show-toplevel'], { cwd: workspaceRoot, timeout: 7000, windowsHide: true })).stdout.trim();
    if (path.resolve(top) !== path.resolve(workspaceRoot)) {
      return { isRepositoryRoot: false, message: 'Workspace root is not the repository root.' };
    }
    const branch = (await execFile('git', ['branch', '--show-current'], { cwd: workspaceRoot, timeout: 7000, windowsHide: true })).stdout.trim() || '(detached)';
    const status = (await execFile('git', ['status', '--short', '--branch'], { cwd: workspaceRoot, timeout: 7000, windowsHide: true, maxBuffer: 512 * 1024 })).stdout.trim();
    return { isRepositoryRoot: true, branch, status };
  } catch (error) {
    return { isRepositoryRoot: false, message: String(error?.message || 'Git unavailable.') };
  }
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function makeServer(workspaceRoot) {
  const server = new McpServer({ name: 'aecp-local', version: '0.2.0' });

  server.registerTool(
    'aecp_status',
    {
      description: 'Return the AECP local MCP server status and active Workspace metadata. Read-only.',
      inputSchema: z.object({})
    },
    async () => textResult({
      mode: 'read-only',
      workspaceName: path.basename(workspaceRoot),
      capabilities: ['aecp_status', 'inspect_workspace', 'git_status', 'read_text_file']
    })
  );

  server.registerTool(
    'inspect_workspace',
    {
      description: 'Inspect only the explicitly bound AECP Workspace. Returns direct child names/types. Read-only.',
      inputSchema: z.object({})
    },
    async () => {
      const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
      return textResult({
        workspaceName: path.basename(workspaceRoot),
        entries: entries.slice(0, 200).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : (entry.isFile() ? 'file' : 'other')
        })),
        truncated: entries.length > 200
      });
    }
  );

  server.registerTool(
    'git_status',
    {
      description: 'Return read-only Git branch/status for the active Workspace root.',
      inputSchema: z.object({})
    },
    async () => textResult(await gitStatus(workspaceRoot))
  );

  server.registerTool(
    'read_text_file',
    {
      description: 'Read a UTF-8 text file inside the active Workspace. Absolute paths and traversal are rejected. Read-only.',
      inputSchema: z.object({
        path: z.string().min(1).max(1024)
      })
    },
    async ({ path: relativePath }) => {
      const file = resolveInside(workspaceRoot, relativePath);
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error('Requested path is not a file.');
      if (stat.size > MAX_TEXT_BYTES) throw new Error('File is larger than the 256 KiB read-only MCP limit.');
      return textResult({
        path: relativePath,
        bytes: stat.size,
        text: await fs.readFile(file, 'utf8')
      });
    }
  );

  return server;
}

export async function startLocalMcpServer({ workspaceRoot, token, port = 39177 }) {
  if (!workspaceRoot) throw new Error('Workspace is required.');
  if (!token || String(token).length < 32) throw new Error('A strong MCP bearer token is required.');

  const handler = createMcpHandler(() => makeServer(workspaceRoot), { responseMode: 'json' });
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, mode: 'read-only' }));
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    const auth = String(req.headers.authorization || '');
    const expected = `Bearer ${token}`;
    if (!safeEqual(auth, expected)) {
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer',
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    void nodeHandler(req, res);
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/mcp`,
    healthUrl: `http://127.0.0.1:${actualPort}/healthz`,
    mode: 'read-only',
    async stop() {
      await handler.close();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  };
}
