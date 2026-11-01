import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const handlers={},stores=new Map();let connected=true;
const key=r=>new URL(typeof r==='string'?r:r.url,'https://example.test').href;
const network=async r=>{if(!connected)throw Error('offline');return new Response('cached:'+key(r),{status:200})};
const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {addAll:async urls=>{for(const url of urls)data.set(key(url),await network(url))},match:async r=>data.get(key(r))?.clone(),put:async(r,res)=>data.set(key(r),res)}},keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n)};
vm.runInNewContext(fs.readFileSync('dist/sw.js','utf8'),{URL,Response,caches,fetch:network,self:{location:{origin:'https://example.test'},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{},matchAll:async()=>[]}}});
let pending;handlers.install({waitUntil:p=>pending=p});await pending;handlers.activate({waitUntil:p=>pending=p});await pending;connected=false;
async function request(url,mode='cors'){let response;handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>response=p});return response?await response:null;}
assert.ok((await(await request('https://example.test/raji-fitness-center/','navigate')).text()).includes('cached:'));
assert.ok(await request('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'));
const cache=stores.values().next().value;const js=[...cache.keys()].find(k=>/assets\/.*\.js$/.test(k));assert.ok(await request(js));
assert.equal(await request('https://firestore.googleapis.com/v1/projects/test'),null);
assert.equal(await request('https://example.test/other-app/'),null);
console.log('PASS: installed shell, offline navigation, offline JS and Firebase SDK cache; API traffic and other apps excluded.');
