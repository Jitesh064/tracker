const { put, get } = require('@vercel/blob');

async function loadCollection(name, fallback) {
  try {
    const path = `data-${name}.json`;
    const result = await get(path, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) return fallback;
    const text = await new Response(result.stream).text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (e) {
    // Blob not created yet (first run) - treat as empty rather than an error.
    if (e && e.name === 'BlobNotFoundError') return fallback;
    console.error('loadCollection error', name, e);
    return fallback;
  }
}

async function saveCollection(name, data) {
  const path = `data-${name}.json`;
  await put(path, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

module.exports = { loadCollection, saveCollection };
