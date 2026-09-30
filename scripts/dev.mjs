// Local preview: `npm run dev` → http://localhost:3000
// Serves /public and runs /api/subscribe + /api/export with the same code as production.
// With no destinations configured in .env, signups are written to .data/subscribers.csv.

import { createServer } from 'node:http';
import { readFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bearer, handleExport, handleSubscribe, metaFromHeaders, sinksFromEnv, toCsv, wantsJson, CSV_COLUMNS,
} from '../lib/subscribe-core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

// tiny .env loader (.env, then .env.local)
for (const file of ['.env', '.env.local']) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

// Same headers as vercel.json / netlify.toml
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Local CSV destination, used only when .env configures nothing else.
const CSV_PATH = join(ROOT, '.data', 'subscribers.csv');
const localCsvSink = {
  name: 'local-csv',
  async save(record) {
    await mkdir(dirname(CSV_PATH), { recursive: true });
    const rows = await this.list();
    if (rows.some((r) => r.email === record.email)) return { duplicate: true };
    const exists = await stat(CSV_PATH).then(() => true, () => false);
    const csv = toCsv([record]);
    await appendFile(CSV_PATH, exists ? csv.split('\n').slice(1).join('\n') : csv);
    return { duplicate: false };
  },
  async list() {
    const text = await readFile(CSV_PATH, 'utf8').catch(() => '');
    return text.split('\n').slice(1).filter(Boolean).map((line) => {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      return Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, cells[i] || '']));
    });
  },
};
const envSinks = sinksFromEnv(process.env);
const sinks = envSinks.length ? envSinks : [localCsvSink];

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/subscribe') {
    if (req.method !== 'POST') return send(res, 405, 'Method not allowed', { Allow: 'POST' });
    const meta = metaFromHeaders((n) => req.headers[n]);
    meta.ip = meta.ip || req.socket.remoteAddress;
    const result = await handleSubscribe(await readBody(req), meta, process.env, { sinks, limiter: null });
    console.log(`[subscribe] ${result.status}`, JSON.stringify(result.body));
    if (!wantsJson(req.headers.accept)) {
      return send(res, 303, '', { Location: `/?subscribed=${result.body.ok ? 1 : 0}#signup` });
    }
    return send(res, result.status, JSON.stringify(result.body), { 'Content-Type': 'application/json' });
  }

  if (url.pathname === '/api/export') {
    const token = bearer(req.headers.authorization) || url.searchParams.get('token') || '';
    const env = { ...process.env, EXPORT_TOKEN: process.env.EXPORT_TOKEN || 'dev' };
    const out = await handleExport(token, env, sinks === envSinks ? {} : { sink: localCsvSink });
    return send(res, out.status, out.body, { 'Content-Type': out.type });
  }

  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    // Byte ranges: Safari won't play video without them.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start >= data.length || start > end) {
        return send(res, 416, '', { 'Content-Range': `bytes */${data.length}` });
      }
      return send(res, 206, data.subarray(start, end + 1), {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
    }
    return send(res, 200, data, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  } catch {
    const notFound = await readFile(join(PUBLIC, '404.html')).catch(() => 'Not found');
    return send(res, 404, notFound, { 'Content-Type': TYPES['.html'] });
  }
});

server.listen(PORT, () => {
  console.log(`Presentation Craft → http://localhost:${PORT}`);
  console.log(`Signups go to: ${sinks.map((s) => s.name).join(', ')}${sinks[0] === localCsvSink ? ` (${CSV_PATH})` : ''}`);
});
