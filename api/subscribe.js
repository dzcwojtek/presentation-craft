// Vercel Serverless Function → POST /api/subscribe
import { handleSubscribe, metaFromHeaders, wantsJson } from '../lib/subscribe-core.js';

function readBody(req) {
  let body;
  try {
    body = req.body; // Vercel parses JSON and form bodies; throws on malformed JSON
  } catch {
    return {};
  }
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); }
  }
  if (Buffer.isBuffer(body)) {
    const text = body.toString('utf8');
    try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
  }
  return body || {};
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const meta = metaFromHeaders((name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  });
  const result = await handleSubscribe(readBody(req), meta, process.env);

  // Plain HTML form post (no JavaScript): send the visitor back to the page.
  if (!wantsJson(req.headers.accept)) {
    res.statusCode = 303;
    res.setHeader('Location', `/?subscribed=${result.body.ok ? 1 : 0}#signup`);
    return res.end();
  }
  return res.status(result.status).json(result.body);
}
