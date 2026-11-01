import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createHash} from 'node:crypto';
const base='/raji-fitness-center/';
function offlineShell(){return {name:'raji-offline-shell',generateBundle(_,bundle){
 const files=Object.keys(bundle).filter(p=>!p.endsWith('.map'));const version=createHash('sha256').update(files.join(',')+Date.now()).digest('hex').slice(0,12);
 const assets=[base,...files.map(p=>base+p),base+'favicon.svg',base+'manifest.webmanifest',base+'images/raji-gym-classic.webp',...['app','auth','firestore'].map(m=>'https://www.gstatic.com/firebasejs/12.0.0/firebase-'+m+'.js')];
 const sw=`const CACHE='raji-shell-${version}',ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(ASSETS);await self.skipWaiting()})));self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('raji-shell-')&&k!==CACHE)await caches.delete(k);await self.clients.claim();for(const c of await self.clients.matchAll())c.postMessage({type:'OFFLINE_READY'})})()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);const asset=u.origin===self.location.origin&&u.pathname.startsWith('${base}');const sdk=u.origin==='https://www.gstatic.com'&&u.pathname.startsWith('/firebasejs/12.0.0/');if(!asset&&!sdk)return;e.respondWith((async()=>{const cache=await caches.open(CACHE);if(e.request.mode==='navigate'){try{return await fetch(e.request)}catch{return await cache.match('${base}')||Response.error()}}const hit=await cache.match(e.request);if(hit)return hit;const response=await fetch(e.request);if(response.ok)await cache.put(e.request,response.clone());return response})())});`;
 this.emitFile({type:'asset',fileName:'sw.js',source:sw});
 }};}
export default defineConfig({base,plugins:[react(),offlineShell()],build:{rollupOptions:{external:id=>id.startsWith('https://')}}});
