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
    // Any other error (network blip, transient service issue, bad JSON, etc.) must NOT be
    // silently treated as "this file is empty." Saves do read-modify-write: read the current
    // list, add one item, write it back. If a transient read failure were swallowed here, the
    // caller would think the list was empty and overwrite it with just the one new item,
    // destroying everything else that was in it. Propagating the error instead makes the save
    // fail loudly (safe to retry) rather than quietly deleting data.
    console.error('loadJSON error (propagating, not treating as empty)', path, e);
    throw e;
  }
}

async function saveJSON(path, data) {
  await put(path, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0, // these change on every save - never serve a stale cached copy
  });
}

async function loadState(fallback) { return loadJSON(STATE_PATH, fallback); }
async function saveState(state) { return saveJSON(STATE_PATH, state); }

module.exports = { loadJSON, saveJSON, loadState, saveState };
