const { loadJSON, saveJSON, loadState } = require('../lib/blob');
const { verifyToken, getBearerToken } = require('../lib/auth');

const ARRAY_SECTIONS = ['salary_a', 'salary_b', 'expenses_a', 'expenses_b', 'snapshots', 'assets', 'recurring_a', 'recurring_b', 'govtbenefits_a', 'govtbenefits_b'];
const ALLOWED_COLLECTIONS = ['settings', ...ARRAY_SECTIONS];
const MIGRATION_MARKER = 'migration-v3-percollection.json';

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pathFor(col) { return `data-${col}.json`; }

// This app has used a few different storage layouts over time: per-collection files, then one
// combined 'ledger-state.json' file, now per-collection files again. Because the current layout
// reuses the same file names as the very first one, we can't just check "does this file already
// exist" to decide whether a collection has been migrated - a leftover file from that much
// earlier version would look like it's "already there" and shadow the real, current data that's
// actually sitting in the combined file. Instead this runs a forced one-time migration, guarded
// by an explicit marker, that overwrites every per-collection file from the combined state.
let migrationDone = null;
async function ensureMigrated() {
  if (migrationDone) return;
  const marker = await loadJSON(MIGRATION_MARKER, null);
  if (marker) { migrationDone = true; return; }
  const legacy = await loadState(null);
  if (legacy) {
    await Promise.all(ALLOWED_COLLECTIONS.map(async (col) => {
      let val = legacy[col];
      if (col === 'snapshots' && val === undefined && (legacy.snapshots_a || legacy.snapshots_b)) {
        val = [...(legacy.snapshots_a || []), ...(legacy.snapshots_b || [])];
      }
      if (val === undefined) val = col === 'settings' ? null : [];
      await saveJSON(pathFor(col), val);
    }));
  }
  await saveJSON(MIGRATION_MARKER, { migratedAt: Date.now() });
  migrationDone = true;
}
async function loadCollection(col) {
  await ensureMigrated();
  const isSettings = col === 'settings';
  const existing = await loadJSON(pathFor(col), undefined);
  if (existing !== undefined) return existing;
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
