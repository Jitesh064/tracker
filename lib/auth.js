const crypto = require('crypto');

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET environment variable is not set. Add one in Vercel project settings.');
  return s;
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

// Minimal signed, stateless session token (HMAC-SHA256) - no external JWT library needed.
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('hex');
  return body + '.' + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let expected;
  try { expected = crypto.createHmac('sha256', getSecret()).update(body).digest('hex'); }
  catch (e) { return null; }
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getBearerToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

module.exports = { signToken, verifyToken, hashPassword, verifyPassword, getBearerToken };
