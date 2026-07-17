const { put, list } = require('@vercel/blob');

async function loadCollection(name, fallback) {
  try {
    const path = `data-${name}.json`;
    const { blobs } = await list({ prefix: path });
    const found = blobs.find((b) => b.pathname === path);
    if (!found) return fallback;
    const res = await fetch(found.url, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch (e) {
    console.error('loadCollection error', name, e);
    return fallback;
  }
}

async function saveCollection(name, data) {
  const path = `data-${name}.json`;
  await put(path, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

module.exports = { loadCollection, saveCollection };
