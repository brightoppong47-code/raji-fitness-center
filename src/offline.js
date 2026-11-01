// Device cache and durable, account-scoped outbox. Firebase remains authoritative.
let opening;
function database(){if(!globalThis.indexedDB)return Promise.reject(Error('Offline storage is unavailable in this browser.'));return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open('raji-offline-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('cache');r.result.createObjectStore('outbox',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function access(store,mode,fn){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);const r=fn(tx.objectStore(store));tx.oncomplete=()=>resolve(r?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Offline storage could not be saved.'));});}
export const online=()=>typeof navigator==='undefined'||navigator.onLine!==false;
export function notify(){if(typeof window!=='undefined')window.dispatchEvent(new Event('raji-sync'));}
export async function cacheData(uid,data){if(!globalThis.indexedDB)return;await access('cache','readwrite',s=>s.put({data,savedAt:new Date().toISOString()},uid));}
export async function cachedData(uid){if(!globalThis.indexedDB)return null;return access('cache','readonly',s=>s.get(uid));}
export async function clearCache(uid){if(globalThis.indexedDB)await access('cache','readwrite',s=>s.delete(uid));}
export async function queueEntries(uid){if(!globalThis.indexedDB)return [];return (await access('outbox','readonly',s=>s.getAll())).filter(r=>r.uid===uid).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
export async function enqueue(uid,payload,expectedFee){const row={id:crypto.randomUUID(),uid,createdAt:new Date().toISOString(),payload,expectedFee,error:null};await access('outbox','readwrite',s=>s.put(row));notify();return row;}
export async function removeEntry(id){await access('outbox','readwrite',s=>s.delete(id));notify();}
export async function markError(row,error){await access('outbox','readwrite',s=>s.put({...row,error}));notify();}
export async function flushQueue(uid,send){for(const row of await queueEntries(uid)){try{await send({...row.payload,operationId:row.id,capturedAt:row.createdAt,expectedFee:row.expectedFee,offlineEntry:true});await removeEntry(row.id);}catch(e){await markError(row,e.message||'Unable to sync');break;}}}
