'use strict';

// A release is one complete shell. Never refresh HTML or modules separately
// inside the active cache: that can combine a new view with an old controller.
const SHELL_FINGERPRINT = 'dd9c1db677ac';
const VERSION = 'bilal-near-v28';
const SHELL = VERSION + '-' + SHELL_FINGERPRINT + '-shell';
const TIMETABLE_CACHE = 'bilal-near-timetables-v1';
const SHELL_PATHS = [
  '/near.html', '/near-core.js', '/near-app.mjs', '/near-data.mjs',
  '/near-time.mjs', '/near-model.mjs', '/near-session.mjs',
  '/near-preference.mjs', '/near-atmosphere.mjs', '/near-install.mjs',
  '/near-install-ui.mjs', '/near-preview.mjs', '/near.css',
  '/near-request.mjs', '/near-request-ui.mjs', '/near-request.css',
  '/near-opening.mjs', '/near-opening.css', '/bilal-mark-192.png',
  '/near-native.css', '/near-atmosphere.css', '/near-install.css',
  '/near-preference.css', '/near.webmanifest', '/near-qr.svg',
  '/diag.js', '/favicon.ico', '/icon-180.png', '/icon-192.png',
  '/icon-512.png', '/icon-1024.png', '/mosques.json',
  '/fonts/prata-latin.woff2', '/fonts/archivo-latin.woff2'
];
const SHELL_VERSIONED = { '/diag.js': '/diag.js?v=2' };
const ON_DEMAND_PATHS = [
  '/athan.mp3', '/sky/fajr.webp', '/sky/dhuhr.webp', '/sky/asr.webp',
  '/sky/maghrib.webp', '/sky/isha.webp', '/sky/clouds.png', '/sky/stars.png'
];
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    // Bypass the HTTP cache at installation, then expose the release only
    // after every required file has arrived successfully.
    await cache.addAll(SHELL_PATHS.map(path=>new Request(SHELL_VERSIONED[path]||path,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('bilal-near-')&&key!==SHELL&&key!==TIMETABLE_CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
async function shellRequest(request) {
  const cache=await caches.open(SHELL),hit=await cache.match(request);
  return hit||fetch(request);
}
async function pageRequest(request) {
  const cache=await caches.open(SHELL),hit=await cache.match('/near.html');
  return hit||fetch(request);
}
async function directoryRequest(request) {
  const cache=await caches.open(SHELL);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(request,{signal:controller.signal,cache:'no-cache'});
    if(!response.ok)throw new Error('directory unavailable');
    await cache.put(request,response.clone());return response;
  }catch(error){const hit=await cache.match(request);if(hit)return hit;throw error;}
  finally{clearTimeout(timer);}
}
async function atmosphereRequest(request) {
  const cache=await caches.open(SHELL),hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;
}
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  // Timetables own their bounded, dated fallback in near-data.mjs. This
  // worker never stores geocoding queries, positions or unrelated Bilal pages.
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'&&['/near','/near/','/near.html'].includes(url.pathname)){
    if(url.searchParams.get('preview')==='1')return;
    event.respondWith(pageRequest(event.request));return;
  }
  if(url.pathname==='/mosques.json'){event.respondWith(directoryRequest(event.request));return;}
  if(SHELL_PATHS.includes(url.pathname)){event.respondWith(shellRequest(event.request));return;}
  if(ON_DEMAND_PATHS.includes(url.pathname))event.respondWith(atmosphereRequest(event.request));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){const url=new URL(client.url);if(url.origin===self.location.origin&&['/near','/near/','/near.html'].includes(url.pathname))return client.focus();}
    return self.clients.openWindow('/near');
  })());
});
