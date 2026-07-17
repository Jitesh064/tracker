const { loadCollection, saveCollection } = require('../lib/blob');
const { signToken, verifyToken, hashPassword, verifyPassword, getBearerToken } = require('../lib/auth');

const USERS_COL = 'auth_users';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function getUsers() { return loadCollection(USERS_COL, []); }
async function saveUsers(u) { return saveCollection(USERS_COL, u); }

// If no users exist yet, bootstrap the first admin from env vars (set once, then manage
// further accounts from the Users page). Keeps a real password out of the codebase.
async function ensureBootstrapAdmin(users) {
  if (users.length) return users;
  const su = process.env.SEED_ADMIN_USERNAME, sp = process.env.SEED_ADMIN_PASSWORD;
  if (!su || !sp) return users;
  const admin = { id: uid(), username: su.trim().toLowerCase(), name: 'Admin', role: 'admin', passwordHash: hashPassword(sp) };
  users.push(admin);
  await saveUsers(users);
  return users;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!process.env.AUTH_SECRET) {
      res.status(500).json({ error: 'AUTH_SECRET is not configured on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.' });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const action = body.action;

    if (action === 'login') {
      let users = await getUsers();
      users = await ensureBootstrapAdmin(users);
      const uname = (body.username || '').trim().toLowerCase();
      const u = users.find((x) => x.username === uname);
      if (!u || !verifyPassword(body.password || '', u.passwordHash)) {
        res.status(401).json({ error: 'Invalid username or password' });
        return;
      }
      const payload = { id: u.id, username: u.username, name: u.name, role: u.role, exp: Date.now() + TOKEN_TTL_MS };
      const token = signToken(payload);
      res.status(200).json({ token, user: { id: u.id, username: u.username, name: u.name, role: u.role } });
      return;
    }

    if (action === 'verify') {
      const payload = verifyToken(body.token);
      if (!payload) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
      res.status(200).json({ user: { id: payload.id, username: payload.username, name: payload.name, role: payload.role } });
      return;
    }

    // Everything below requires a valid session.
    const authed = verifyToken(getBearerToken(req));
    if (!authed) { res.status(401).json({ error: 'Not authenticated' }); return; }

    if (action === 'list-users') {
      if (authed.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
      const users = await getUsers();
      res.status(200).json({ users: users.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })) });
      return;
    }

    if (action === 'save-user') {
      if (authed.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
      const { userId, userUsername, userName, userRole, userPassword } = body;
      if (!userUsername || !userName || !userRole) { res.status(400).json({ error: 'Missing fields' }); return; }
      const uname = userUsername.trim().toLowerCase();
      const users = await getUsers();
      const dup = users.find((u) => u.username === uname && u.id !== userId);
      if (dup) { res.status(400).json({ error: 'That username is already taken' }); return; }
      if (userId) {
        const existing = users.find((u) => u.id === userId);
        if (!existing) { res.status(404).json({ error: 'User not found' }); return; }
        existing.username = uname; existing.name = userName; existing.role = userRole;
        if (userPassword) existing.passwordHash = hashPassword(userPassword);
      } else {
        if (!userPassword) { res.status(400).json({ error: 'Password required for new users' }); return; }
        users.push({ id: uid(), username: uname, name: userName, role: userRole, passwordHash: hashPassword(userPassword) });
      }
      await saveUsers(users);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'delete-user') {
      if (authed.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
      if (body.userId === authed.id) { res.status(400).json({ error: "You can't delete the account you're signed in as" }); return; }
      const users = await getUsers();
      await saveUsers(users.filter((u) => u.id !== body.userId));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('auth handler error', e);
    res.status(500).json({ error: 'Server error: ' + (e && e.message ? e.message : 'unknown') });
  }
};
