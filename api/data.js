const { loadState, saveState } = require('../lib/blob');
const { verifyToken, getBearerToken } = require('../lib/auth');

const ARRAY_SECTIONS = ['salary_a', 'salary_b', 'expenses_a', 'expenses_b', 'snapshots_a', 'snapshots_b', 'assets'];
const ALLOWED_COLLECTIONS = ['settings', ...ARRAY_SECTIONS];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function defaultState() {
  return {
    settings: null, // filled in by the client's defaultSettings() on first load
    salary_a: [], salary_b: [],
    expenses_a: [], expenses_b: [],
    snapshots_a: [], snapshots_b: [],
    assets: [],
  };
}

module.exports = async (req, res) => {
  try {
    if (!process.env.AUTH_SECRET) {
      res.status(500).json({ error: 'AUTH_SECRET is not configured on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
      return;
    }

    const user = verifyToken(getBearerToken(req));
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const col = (req.query && req.query.col) || '';

    // GET with no col: return the whole consolidated state in ONE blob read.
    // This is what the app uses on load and on manual/visibility-triggered refresh.
    if (req.method === 'GET' && !col) {
      const state = await loadState(defaultState());
      res.status(200).json({ data: state });
      return;
    }

    if (!ALLOWED_COLLECTIONS.includes(col)) { res.status(400).json({ error: 'Unknown collection: ' + col }); return; }

    if (req.method === 'GET') {
      const state = await loadState(defaultState());
      if (col === 'settings') { res.status(200).json({ data: state.settings ? [state.settings] : [] }); return; }
      res.status(200).json({ data: state[col] || [] });
      return;
    }

    if (req.method === 'POST') {
      if (user.role === 'viewer') { res.status(403).json({ error: 'Viewers cannot make changes' }); return; }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const state = await loadState(defaultState());

      if (col === 'settings') {
        if (body.op === 'save') { state.settings = body.item || state.settings; }
        else if (body.op === 'replace') { state.settings = (Array.isArray(body.data) && body.data[0]) || state.settings; }
        else { res.status(400).json({ error: 'Unknown op' }); return; }
        await saveState(state);
        res.status(200).json({ ok: true, data: state.settings ? [state.settings] : [] });
        return;
      }

      const arr = Array.isArray(state[col]) ? state[col] : [];
      if (body.op === 'save') {
        const item = body.item || {};
        if (!item.id) item.id = uid();
        const idx = arr.findIndex((x) => x.id === item.id);
        if (idx >= 0) arr[idx] = item; else arr.push(item);
        state[col] = arr;
        await saveState(state);
        res.status(200).json({ ok: true, data: arr });
        return;
      }
      if (body.op === 'delete') {
        state[col] = arr.filter((x) => x.id !== body.id);
        await saveState(state);
        res.status(200).json({ ok: true, data: state[col] });
        return;
      }
      if (body.op === 'replace') {
        state[col] = Array.isArray(body.data) ? body.data : [];
        await saveState(state);
        res.status(200).json({ ok: true, data: state[col] });
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
