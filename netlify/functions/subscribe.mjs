// Netlify Function → POST /api/subscribe
import { handleSubscribe, metaFromHeaders, parseRequestBody, wantsJson } from '../../lib/subscribe-core.js';

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST' });

  const meta = metaFromHeaders((name) => req.headers.get(name));
  meta.ip = context?.ip || meta.ip;
  meta.country = context?.geo?.country?.code || meta.country;

  const result = await handleSubscribe(await parseRequestBody(req), meta, process.env);

  if (!wantsJson(req.headers.get('accept'))) {
    return new Response(null, {
      status: 303,
      headers: { Location: `/?subscribed=${result.body.ok ? 1 : 0}#signup` },
    });
  }
  return json(result.status, result.body);
};

export const config = { path: '/api/subscribe' };
