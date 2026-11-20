/* Local-first storage. PDF blobs live in IndexedDB, not localStorage. */
(() => {
  const DB_NAME = "pdf-reader-pro-db";
  const DB_VERSION = 2;
  let dbPromise;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("documents")) {
          const store = db.createObjectStore("documents", {keyPath:"id"});
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("bookmarks")) db.createObjectStore("bookmarks", {keyPath:"id"});
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", {keyPath:"docId"});
        if (!db.objectStoreNames.contains("annotations")) db.createObjectStore("annotations", {keyPath:"id"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function tx(store, mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  window.PDFDB = {
    async allDocs(){ const db=await openDB(); return new Promise((res,rej)=>{const r=db.transaction("documents").objectStore("documents").getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);}); },
    putDoc(doc){return tx("documents","readwrite",s=>s.put(doc));},
    getDoc(id){return tx("documents","readonly",s=>s.get(id));},
    deleteDoc(id){return Promise.all([tx("documents","readwrite",s=>s.delete(id)),tx("history","readwrite",s=>s.delete(id))]);},
    putBookmark(item){return tx("bookmarks","readwrite",s=>s.put(item));},
    async bookmarks(docId){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction("bookmarks").objectStore("bookmarks").getAll();r.onsuccess=()=>res((r.result||[]).filter(x=>x.docId===docId));r.onerror=()=>rej(r.error);});},
    deleteBookmark(id){return tx("bookmarks","readwrite",s=>s.delete(id));},
    putHistory(item){return tx("history","readwrite",s=>s.put(item));},
    getHistory(id){return tx("history","readonly",s=>s.get(id));},
    async annotations(docId){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction("annotations").objectStore("annotations").getAll();r.onsuccess=()=>res((r.result||[]).filter(x=>x.docId===docId));r.onerror=()=>rej(r.error);});},
    putAnnotation(item){return tx("annotations","readwrite",s=>s.put(item));}
  };
})();
