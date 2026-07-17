const { put, get } = require('@vercel/blob');

const STATE_PATH = 'ledger-state.json';

async function loadState(fallback) {
  try {
    const result = await get(STATE_PATH, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return fallback;
    const text = await new Response(result.stream).text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (e) {
    if (e && e.name === 'BlobNotFoundError') return fallback;
    console.error('loadState error', e);
    return fallback;
  }
}

async function saveState(state) {
  await put(STATE_PATH, JSON.stringify(state), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

module.exports = { loadState, saveState };
