const { loadJSON, saveJSON, loadState } = require('../lib/blob');
const { verifyToken, getBearerToken } = require('../lib/auth');

const ARRAY_SECTIONS = ['salary_a', 'salary_b', 'expenses_a', 'expenses_b', 'snapshots', 'assets', 'recurring_a', 'recurring_b', 'govtbenefits_a', 'govtbenefits_b'];
const ALLOWED_COLLECTIONS = ['settings', ...ARRAY_SECTIONS];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pathFor(col) { return `data-${col}.json`; }

// Each collection now lives in its OWN blob file, so saving one person's salary entry never
// touches (and can never race against) another collection's file. Older versions of this app
// kept everything in one combined 'ledger-state.json' file; if a collection's own file doesn't
// exist yet, we fall back to reading it out of that old combined file once, then split it out.
let legacyStateCache = null;
async function legacyState() {
  if (legacyStateCache === null) legacyStateCache = await loadState(null);
  return legacyStateCache;
}
async function loadCollection(col) {
  const isSettings = col === 'settings';
  const existing = await loadJSON(pathFor(col), undefined);
  if (existing !== undefined) return existing;
  const legacy = await legacyState();
  if (legacy && legacy[col] !== undefined) {
    await saveJSON(pathFor(col), legacy[col]);
    return legacy[col];
  }
  // Very old versions split cash & investments per profile before it became one shared list.
  if (col === 'snapshots' && legacy && (legacy.snapshots_a || legacy.snapshots_b)) {
    const merged = [...(legacy.snapshots_a || []), ...(legacy.snapshots_b || [])];
    await saveJSON(pathFor(col), merged);
    return merged;
  }
  return isSettings ? null : [];
}
async function saveCollection(col, data) { await saveJSON(pathFor(col), data); }

module.exports = async (req, res) => {
  try {
    if (!process.env.AUTH_SECRET) {
      res.status(500).json({ error: 'AUTH_SECRET is not configured on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
      return;
    }

    const user = verifyToken(getBearerToken(req));
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const col = (req.query && req.query.col) || '';

    // GET with no col: return every collection at once (parallel reads - still just one round
    // trip from the frontend's perspective, but each collection is its own file underneath).
    if (req.method === 'GET' && !col) {
      const entries = await Promise.all(ALLOWED_COLLECTIONS.map(async (c) => [c, await loadCollection(c)]));
      res.status(200).json({ data: Object.fromEntries(entries) });
      return;
    }

    if (!ALLOWED_COLLECTIONS.includes(col)) { res.status(400).json({ error: 'Unknown collection: ' + col }); return; }

    if (req.method === 'GET') {
      const val = await loadCollection(col);
      if (col === 'settings') { res.status(200).json({ data: val ? [val] : [] }); return; }
      res.status(200).json({ data: val || [] });
      return;
    }

    if (req.method === 'POST') {
      if (user.role === 'viewer') { res.status(403).json({ error: 'Viewers cannot make changes' }); return; }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

      if (col === 'settings') {
        let settings = await loadCollection('settings');
        if (body.op === 'save') { settings = body.item || settings; }
        else if (body.op === 'replace') { settings = (Array.isArray(body.data) && body.data[0]) || settings; }
        else { res.status(400).json({ error: 'Unknown op' }); return; }
        await saveCollection('settings', settings);
        res.status(200).json({ ok: true, data: settings ? [settings] : [] });
        return;
      }

      const arr = (await loadCollection(col)) || [];
      if (body.op === 'save') {
        const item = body.item || {};
        if (!item.id) item.id = uid();
        const idx = arr.findIndex((x) => x.id === item.id);
        if (idx >= 0) arr[idx] = item; else arr.push(item);
        await saveCollection(col, arr);
        res.status(200).json({ ok: true, data: arr });
        return;
      }
      if (body.op === 'delete') {
        const next = arr.filter((x) => x.id !== body.id);
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
