// Cross-origin message bridge loaded by GET /api/receive.
// aiPromptLibOrigins must match aiPromptLibOrigins in src/lib/cors.ts.
// UPLOAD_DB_NAME / UPLOAD_STORE must match UPLOAD_DB_NAME / UPLOAD_STORE in src/lib/quick-create.ts.
const aiPromptLibOrigins = new Set([
  'https://www.dev-godaddy.com',
  'https://www.test-godaddy.com',
  'https://www.godaddy.com',
  'https://start.dev-godaddy.com',
  'https://start.test-godaddy.com',
  'https://start.dev-godaddy.com:8443',
  'https://start.test-godaddy.com:8443',
  'https://start.godaddy.com',
  'https://dashboard.dev-godaddy.com',
  'https://dashboard.test-godaddy.com',
  'https://dashboard.godaddy.com',
]);
const UPLOAD_DB_NAME = 'airo-file-uploads';
const UPLOAD_STORE = 'files';

(() => {
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(UPLOAD_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(UPLOAD_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const storeFiles = (siteId, files) => {
    if (!files.length) return Promise.resolve();
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readwrite');
      tx.objectStore(UPLOAD_STORE).put({ files }, siteId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  };

  window.addEventListener('message', event => {
    if (!aiPromptLibOrigins.has(event.origin)) return;
    const d = event.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    if (d.type === 'store-files') {
      if (!d.data || typeof d.data.siteId !== 'string' || !Array.isArray(d.data.files)) return;
      const { siteId, files } = d.data;
      const validFiles = files.filter(f => f && typeof f.fileName === 'string');
      try {
        localStorage.setItem('in-creation-flow-' + siteId, 'true');
        localStorage.setItem('initial-prompt-pending-' + siteId, 'true');
        localStorage.setItem(
          'initial-upload-files-' + siteId,
          JSON.stringify(validFiles.map(({ raw, fileName, ...rest }) => ({ name: fileName, ...rest })))
        );
      } catch (err) {
        console.error('Failed to store uploaded files metadata in localStorage', { siteId, err });
        event.source?.postMessage({ type: 'store-files-ack', error: 'localStorage' }, event.origin);
        return;
      }
      storeFiles(siteId, validFiles)
        .then(() => {
          event.source?.postMessage({ type: 'store-files-ack' }, event.origin);
        })
        .catch(err => {
          console.error('Failed to store uploaded files in IndexedDB', { siteId, error: err });
          // Roll back localStorage keys so stale metadata doesn't point at absent binary data.
          localStorage.removeItem('in-creation-flow-' + siteId);
          localStorage.removeItem('initial-prompt-pending-' + siteId);
          localStorage.removeItem('initial-upload-files-' + siteId);
          event.source?.postMessage({ type: 'store-files-ack', error: 'indexedDB' }, event.origin);
        });
    }
  });
})();
