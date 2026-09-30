import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell, handleExport, handleSubscribe, normalizeEmail, originAllowed,
  redisSink, sheetsSink, sinksFromEnv, siteUrl, toCsv,
} from '../lib/subscribe-core.js';

const memorySink = () => {
  const rows = new Map();
  return {
    name: 'memory',
    rows,
    async save(r) { if (rows.has(r.email)) return { duplicate: true }; rows.set(r.email, r); return { duplicate: false }; },
    async list() { return [...rows.values()]; },
  };
};
const failingSink = { name: 'broken', async save() { throw new Error('boom'); } };
const quiet = () => { const orig = console.error; console.error = () => {}; return () => { console.error = orig; }; };

test('normalizeEmail', () => {
  assert.equal(normalizeEmail('  Hello@Example.COM '), 'hello@example.com');
  assert.equal(normalizeEmail('a.b+tag@sub.example.co'), 'a.b+tag@sub.example.co');
  for (const bad of ['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'x@.com', null, 42, `${'a'.repeat(65)}@x.com`]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('saves a new email and flags duplicates', async () => {
  const sink = memorySink();
  const deps = { sinks: [sink], limiter: null };
  const first = await handleSubscribe({ email: 'Me@Site.com', source: 'hero', t: 5000 }, {}, {}, deps);
  assert.deepEqual(first, { status: 200, body: { ok: true, duplicate: false } });
  assert.equal(sink.rows.get('me@site.com').source, 'hero');
  const again = await handleSubscribe({ email: 'me@site.com', t: 5000 }, {}, {}, deps);
  assert.deepEqual(again.body, { ok: true, duplicate: true });
});

test('rejects invalid email with 400', async () => {
  const r = await handleSubscribe({ email: 'nope' }, {}, {}, { sinks: [memorySink()], limiter: null });
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('honeypot and too-fast submissions are silently dropped', async () => {
  const sink = memorySink();
  const deps = { sinks: [sink], limiter: null };
  assert.equal((await handleSubscribe({ email: 'a@b.co', company: 'Acme' }, {}, {}, deps)).body.ok, true);
  assert.equal((await handleSubscribe({ email: 'a@b.co', t: 300 }, {}, {}, deps)).body.ok, true);
  assert.equal(sink.rows.size, 0);
  // no-JS form posts have no `t` and must still work
  assert.equal((await handleSubscribe({ email: 'a@b.co' }, {}, {}, deps)).status, 200);
  assert.equal(sink.rows.size, 1);
});

test('503 when nothing is configured', async () => {
  const restore = quiet();
  const r = await handleSubscribe({ email: 'a@b.co' }, {}, {}, { limiter: null });
  restore();
  assert.equal(r.status, 503);
});

test('succeeds if at least one destination works, 502 if all fail', async () => {
  const restore = quiet();
  const ok = await handleSubscribe({ email: 'a@b.co' }, {}, {}, { sinks: [failingSink, memorySink()], limiter: null });
  const bad = await handleSubscribe({ email: 'a@b.co' }, {}, {}, { sinks: [failingSink], limiter: null });
  restore();
  assert.equal(ok.status, 200);
  assert.equal(bad.status, 502);
});

test('rate limiter blocks with 429', async () => {
  const r = await handleSubscribe({ email: 'a@b.co' }, { ip: '1.2.3.4' }, {}, { sinks: [memorySink()], limiter: async () => false });
  assert.equal(r.status, 429);
});

test('origin check', async () => {
  assert.equal(originAllowed('', 'site.com'), true);
  assert.equal(originAllowed('https://site.com', 'site.com'), true);
  assert.equal(originAllowed('https://evil.com', 'site.com'), false);
  assert.equal(originAllowed('https://www.site.com', 'site.com', 'https://www.site.com'), true);
  const r = await handleSubscribe({ email: 'a@b.co' }, { origin: 'https://evil.com', host: 'site.com' }, {}, { sinks: [memorySink()], limiter: null });
  assert.equal(r.status, 403);
});

test('sinksFromEnv picks destinations from env names', () => {
  assert.deepEqual(sinksFromEnv({}).map((s) => s.name), []);
  assert.deepEqual(
    sinksFromEnv({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't', SHEETS_WEBHOOK_URL: 'https://s', WEBHOOK_URL: 'https://w' }).map((s) => s.name),
    ['redis', 'sheets', 'webhook'],
  );
});

test('redis sink speaks the Upstash REST protocol', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    const cmd = JSON.parse(init.body);
    calls.push({ url, cmd, auth: init.headers.Authorization });
    const result = cmd[0] === 'HSETNX' ? (calls.length === 1 ? 1 : 0)
      : ['a@b.co', JSON.stringify({ email: 'a@b.co', createdAt: '2026-01-01' })];
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  const sink = redisSink('https://example.upstash.io/', 'tok', fakeFetch);
  assert.deepEqual(await sink.save({ email: 'a@b.co' }), { duplicate: false });
  assert.deepEqual(await sink.save({ email: 'a@b.co' }), { duplicate: true });
  assert.equal(calls[0].url, 'https://example.upstash.io');
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.equal(calls[0].cmd[0], 'HSETNX');
  assert.deepEqual((await sink.list()).map((r) => r.email), ['a@b.co']);
});

test('sheets sink sends the secret and reads the Apps Script reply', async () => {
  let sent;
  const fakeFetch = async (_url, init) => { sent = JSON.parse(init.body); return new Response('{"ok":true,"duplicate":true}'); };
  const sink = sheetsSink('https://script.google.com/macros/s/x/exec', 's3cret', fakeFetch);
  assert.deepEqual(await sink.save({ email: 'a@b.co' }), { duplicate: true });
  assert.equal(sent.secret, 's3cret');
  const htmlFetch = async () => new Response('<html>login</html>', { status: 200 });
  await assert.rejects(sheetsSink('u', 's', htmlFetch).save({ email: 'a@b.co' }), /unexpected response/);
});

test('CSV escaping guards against formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.match(toCsv([{ email: 'a@b.co', source: 'hero' }]), /^email,source,createdAt,country,referer,userAgent\na@b\.co,hero,,,,\n$/);
});

test('export requires the token', async () => {
  const sink = memorySink();
  await sink.save({ email: 'a@b.co', createdAt: 'x' });
  assert.equal((await handleExport('x', {}, { sink })).status, 404);
  assert.equal((await handleExport('wrong', { EXPORT_TOKEN: 'right' }, { sink })).status, 401);
  const ok = await handleExport('right', { EXPORT_TOKEN: 'right' }, { sink });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /a@b\.co/);
});

test('siteUrl builds the site address for the welcome email', () => {
  assert.equal(siteUrl('presentation-craft.vercel.app'), 'https://presentation-craft.vercel.app');
  assert.equal(siteUrl('Example.com'), 'https://example.com');
  assert.equal(siteUrl('localhost:3000'), 'http://localhost:3000');
  assert.equal(siteUrl(''), '');
  assert.equal(siteUrl('evil.com/<script>'), '');
});
