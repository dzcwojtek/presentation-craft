// Shared signup logic used by the Vercel function (api/), the Netlify
// function (netlify/functions/) and the local dev server (scripts/dev.mjs).
//
// Where emails go is decided by environment variables — set one or more:
//   SHEETS_WEBHOOK_URL + SHEETS_WEBHOOK_SECRET   → Google Sheet (Apps Script)
//   UPSTASH_REDIS_REST_URL + _TOKEN              → Upstash Redis (Vercel storage)
//     (or KV_REST_API_URL + KV_REST_API_TOKEN, which Vercel injects)
//   WEBHOOK_URL                                  → any JSON webhook (Zapier, Make…)

import { createHash, timingSafeEqual } from 'node:crypto';

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const REDIS_KEY = 'pc:subscribers';
const RATE_LIMIT = { max: 8, windowSec: 3600 };
const MIN_FILL_MS = 1200; // faster than this from page load = a bot

export const CSV_COLUMNS = ['email', 'source', 'createdAt', 'country', 'referer', 'userAgent'];

/* ---------- helpers ---------- */

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  if (email.split('@')[0].length > 64) return null;
  return email;
}

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

const reply = (status, body) => ({ status, body });

export function wantsJson(accept) {
  return typeof accept === 'string' && accept.includes('application/json');
}

export function metaFromHeaders(get) {
  const forwarded = get('x-forwarded-for') || '';
  return {
    ip: forwarded.split(',')[0].trim() || get('x-real-ip') || get('x-nf-client-connection-ip') || '',
    country: get('x-vercel-ip-country') || get('x-country') || '',
    userAgent: get('user-agent') || '',
    referer: get('referer') || '',
    origin: get('origin') || '',
    host: get('x-forwarded-host') || get('host') || '',
  };
}

// "https://your-domain" from the request's host (http for localhost)
export function siteUrl(host) {
  const h = clean(host, 200).toLowerCase();
  if (!h || !/^[a-z0-9.-]+(:\d+)?$/.test(h)) return '';
  return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(h) ? 'http' : 'https'}://${h}`;
}

export function originAllowed(origin, host, allowList = '') {
  if (!origin) return true; // server-to-server / older browsers
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (host && url.host === host) return true;
  const allowed = allowList.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return allowed.includes(url.origin);
}

/** Parse a Web Request body (Netlify / fetch-style handlers). */
export async function parseRequestBody(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return await request.json();
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      return Object.fromEntries(await request.formData());
    }
    const text = await request.text();
    try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
  } catch {
    return {};
  }
}

/** Guard spreadsheet apps against formula injection and quote for CSV. */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\n')}\n`;
}

export function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

/* ---------- sinks ---------- */

async function redisCommand(url, token, command, fetchImpl = fetch) {
  const res = await fetchImpl(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`redis ${command[0]}: ${data.error || res.status}`);
  return data.result;
}

export function redisSink(url, token, fetchImpl = fetch) {
  return {
    name: 'redis',
    async save(record) {
      const added = await redisCommand(url, token, ['HSETNX', REDIS_KEY, record.email, JSON.stringify(record)], fetchImpl);
      return { duplicate: Number(added) === 0 };
    },
    async list() {
      const flat = (await redisCommand(url, token, ['HGETALL', REDIS_KEY], fetchImpl)) || [];
      const rows = [];
      for (let i = 0; i < flat.length; i += 2) {
        try { rows.push(JSON.parse(flat[i + 1])); } catch { rows.push({ email: flat[i] }); }
      }
      return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
  };
}

export function sheetsSink(url, secret, fetchImpl = fetch) {
  return {
    name: 'sheets',
    async save(record) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secret || '', ...record }),
        redirect: 'follow',
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`sheets: unexpected response (${res.status})`); }
      if (!data.ok) throw new Error(`sheets: ${data.error || 'rejected'}`);
      return { duplicate: Boolean(data.duplicate) };
    },
  };
}

export function webhookSink(url, fetchImpl = fetch) {
  return {
    name: 'webhook',
    async save(record) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscriber.created', ...record }),
      });
      if (!res.ok) throw new Error(`webhook: ${res.status}`);
      return { duplicate: false };
    },
  };
}

function redisConfig(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function sinksFromEnv(env, fetchImpl = fetch) {
  const sinks = [];
  const redis = redisConfig(env);
  if (redis) sinks.push(redisSink(redis.url, redis.token, fetchImpl));
  if (env.SHEETS_WEBHOOK_URL) sinks.push(sheetsSink(env.SHEETS_WEBHOOK_URL, env.SHEETS_WEBHOOK_SECRET, fetchImpl));
  if (env.WEBHOOK_URL) sinks.push(webhookSink(env.WEBHOOK_URL, fetchImpl));
  return sinks;
}

/** Per-IP limiter backed by Redis. Returns null when Redis isn't configured. */
export function limiterFromEnv(env, fetchImpl = fetch) {
  const redis = redisConfig(env);
  if (!redis) return null;
  const salt = env.RATE_LIMIT_SALT || 'presentation-craft';
  return async (ip) => {
    const key = `pc:rl:${createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)}`;
    const count = Number(await redisCommand(redis.url, redis.token, ['INCR', key], fetchImpl));
    if (count === 1) await redisCommand(redis.url, redis.token, ['EXPIRE', key, RATE_LIMIT.windowSec], fetchImpl);
    return count <= RATE_LIMIT.max;
  };
}

/* ---------- handlers ---------- */

/**
 * @param {object} input  parsed request body: { email, company (honeypot), source, t }
 * @param {object} meta   from metaFromHeaders()
 * @param {object} env    process.env
 * @param {object} deps   test/dev overrides: { sinks, limiter, now }
 */
export async function handleSubscribe(input, meta = {}, env = {}, deps = {}) {
  const body = input && typeof input === 'object' ? input : {};

  if (!originAllowed(meta.origin, meta.host, env.ALLOWED_ORIGINS)) {
    return reply(403, { ok: false, error: 'Forbidden' });
  }

  // Bots: pretend it worked, store nothing.
  if (clean(body.company, 200)) return reply(200, { ok: true });
  const t = Number(body.t);
  if (body.t !== undefined && body.t !== '' && Number.isFinite(t) && t < MIN_FILL_MS) return reply(200, { ok: true });

  const email = normalizeEmail(body.email);
  if (!email) return reply(400, { ok: false, error: "That email doesn't look quite right" });

  const sinks = deps.sinks || sinksFromEnv(env);
  if (!sinks.length) {
    console.error('[subscribe] no destination configured — set SHEETS_WEBHOOK_URL and/or UPSTASH_REDIS_REST_URL');
    return reply(503, { ok: false, error: "Signups aren't switched on yet. Try again soon" });
  }

  const limiter = deps.limiter !== undefined ? deps.limiter : limiterFromEnv(env);
  if (limiter && meta.ip) {
    let allowed = true;
    try { allowed = await limiter(meta.ip); } catch (err) { console.error('[subscribe] rate limit check failed:', err.message); }
    if (!allowed) return reply(429, { ok: false, error: 'Too many attempts. Try again later' });
  }

  const record = {
    email,
    source: clean(body.source, 40) || 'site',
    createdAt: (deps.now ? deps.now() : new Date()).toISOString(),
    country: clean(meta.country, 8),
    referer: clean(meta.referer, 300),
    userAgent: clean(meta.userAgent, 300),
    site: siteUrl(meta.host), // the site's own address, for links + images in the welcome email
  };

  const results = await Promise.allSettled(sinks.map((sink) => sink.save(record)));
  const saved = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') saved.push(r.value || {});
    else console.error(`[subscribe] ${sinks[i].name} failed:`, r.reason?.message || r.reason);
  });

  if (!saved.length) {
    return reply(502, { ok: false, error: "Couldn't save your email right now. Try again in a bit" });
  }
  return reply(200, { ok: true, duplicate: saved.every((s) => s.duplicate) });
}

/**
 * CSV export of the Redis list. Google Sheets users can just open the sheet.
 * Auth: `Authorization: Bearer <EXPORT_TOKEN>` or `?token=<EXPORT_TOKEN>`.
 */
export async function handleExport(token, env = {}, deps = {}) {
  if (!env.EXPORT_TOKEN) {
    return { status: 404, type: 'text/plain', body: 'Export is off. Set EXPORT_TOKEN to enable it.\n' };
  }
  if (!tokenMatches(token, env.EXPORT_TOKEN)) {
    return { status: 401, type: 'text/plain', body: 'Unauthorized\n' };
  }
  const sink = deps.sink || (() => {
    const redis = redisConfig(env);
    return redis ? redisSink(redis.url, redis.token) : null;
  })();
  if (!sink || !sink.list) {
    return { status: 404, type: 'text/plain', body: 'Export needs Upstash Redis. With Google Sheets, open the sheet instead.\n' };
  }
  const rows = await sink.list();
  return { status: 200, type: 'text/csv; charset=utf-8', body: toCsv(rows) };
}

export function bearer(authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  return m ? m[1].trim() : '';
}
