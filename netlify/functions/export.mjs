// Netlify Function → GET /api/export  (CSV of the Redis list)
import { bearer, handleExport } from '../../lib/subscribe-core.js';

export default async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed\n', { status: 405, headers: { Allow: 'GET' } });
  const url = new URL(req.url);
  const token = bearer(req.headers.get('authorization')) || url.searchParams.get('token') || '';
  try {
    const out = await handleExport(token, process.env);
    const headers = { 'Content-Type': out.type, 'Cache-Control': 'no-store' };
    if (out.status === 200) headers['Content-Disposition'] = 'attachment; filename="subscribers.csv"';
    return new Response(out.body, { status: out.status, headers });
  } catch (err) {
    console.error('[export] failed:', err.message);
    return new Response('Export failed\n', { status: 502 });
  }
};

export const config = { path: '/api/export' };
