const { loadCollection, saveCollection } = require('../lib/blob');
const { verifyToken, getBearerToken } = require('../lib/auth');

const ALLOWED_COLLECTIONS = [
  'settings',       // single-item collection, one row with id:'settings'
  'salary_a', 'salary_b',
  'expenses_a', 'expenses_b',
  'snapshots_a', 'snapshots_b',
  'assets',
];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

module.exports = async (req, res) => {
  try {
    if (!process.env.AUTH_SECRET) {
      res.status(500).json({ error: 'AUTH_SECRET is not configured on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
      return;
    }

    const user = verifyToken(getBearerToken(req));
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const col = (req.query && req.query.col) || '';
    if (!ALLOWED_COLLECTIONS.includes(col)) { res.status(400).json({ error: 'Unknown collection: ' + col }); return; }

    if (req.method === 'GET') {
      const data = await loadCollection(col, []);
      res.status(200).json({ data });
      return;
    }

    if (req.method === 'POST') {
      if (user.role === 'viewer') { res.status(403).json({ error: 'Viewers cannot make changes' }); return; }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const data = await loadCollection(col, []);

      if (body.op === 'save') {
        const item = body.item || {};
        if (!item.id) item.id = uid();
        const idx = data.findIndex((x) => x.id === item.id);
        if (idx >= 0) data[idx] = item; else data.push(item);
        await saveCollection(col, data);
        res.status(200).json({ ok: true, data });
        return;
      }
      if (body.op === 'delete') {
        const next = data.filter((x) => x.id !== body.id);
        await saveCollection(col, next);
        res.status(200).json({ ok: true, data: next });
        return;
      }
      if (body.op === 'replace') {
        const next = Array.isArray(body.data) ? body.data : [];
        await saveCollection(col, next);
        res.status(200).json({ ok: true, data: next });
        return;
      }
      res.status(400).json({ error: 'Unknown op' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('data handler error', e);
    res.status(500).json({ error: 'Server error: ' + (e && e.message ? e.message : 'unknown') });
  }
};
