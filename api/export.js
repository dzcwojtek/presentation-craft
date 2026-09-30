// Vercel Serverless Function → GET /api/export  (CSV of the Redis list)
// curl -H "Authorization: Bearer $EXPORT_TOKEN" https://your-domain/api/export -o subscribers.csv
import { bearer, handleExport } from '../lib/subscribe-core.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed\n');
  }
  const token = bearer(req.headers.authorization) || req.query?.token || '';
  try {
    const out = await handleExport(token, process.env);
    res.setHeader('Content-Type', out.type);
    if (out.status === 200) res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
    return res.status(out.status).send(out.body);
  } catch (err) {
    console.error('[export] failed:', err.message);
    return res.status(502).send('Export failed\n');
  }
}
