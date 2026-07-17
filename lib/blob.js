const { put, get } = require('@vercel/blob');

const STATE_PATH = 'ledger-state.json';

async function loadJSON(path, fallback) {
  try {
    const result = await get(path, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return fallback;
    const text = await new Response(result.stream).text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (e) {
    if (e && e.name === 'BlobNotFoundError') return fallback;
    console.error('loadJSON error', path, e);
    return fallback;
  }
}

async function saveJSON(path, data) {
  await put(path, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function loadState(fallback) { return loadJSON(STATE_PATH, fallback); }
async function saveState(state) { return saveJSON(STATE_PATH, state); }

module.exports = { loadJSON, saveJSON, loadState, saveState };
