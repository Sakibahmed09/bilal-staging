'use strict';

/* This worker is registered from /near, but GitHub Pages serves the script at
 * the site root. That gives it a broad technical scope, so the fetch handler
 * is intentionally narrow: every route that is not part of Near falls straight
 * through to the network and remains owned by the television experience. */
/* The page is served cache-first, so a shipped change to the shell is invisible
 * until this file's own bytes change and the browser reinstalls the worker.
 * SHELL_FINGERPRINT is that guarantee: it tracks near.html and near-core.js, a
 * test fails the build when it drifts, and updating it is what makes the
 * browser notice. Shipping the page without it strands everyone on the old
 * copy, which is exactly how the 260:56 countdown survived its own fix. */
const SHELL_FINGERPRINT = '82398371df8c';
const VERSION = 'bilal-near-v25';
const SHELL = VERSION + '-shell';
const DATA = VERSION + '-data';
const TIMES_HOST = 'bilal-times.ahmed-sakib.workers.dev';
const SHELL_PATHS = [
  '/near.html',
  '/near-core.js',
  '/diag.js',
  '/near.webmanifest',
  '/favicon.ico',
  '/bilal-mark-192.png',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-1024.png',
  '/mosques.json',
  '/fonts/prata-latin.woff2',
  '/fonts/archivo-latin.woff2'
];
/* Cached under the same versioned URL the page asks for, or the install warms
   one entry and every launch fetches another. */
const SHELL_VERSIONED = { '/near-core.js': '/near-core.js?v=8', '/diag.js': '/diag.js?v=2' };
const SHELL_INSTALL_PATHS = SHELL_PATHS.map(function(path) {
  return SHELL_VERSIONED[path] || path;
});
/* Only the sky for the current prayer is fetched. Pre-caching all five made a
   first visit download nearly 700 KB of scenery while the user was waiting
   for the actual answer. */
const ON_DEMAND_PATHS = [
  '/athan.mp3',
  '/sky/fajr.webp', '/sky/dhuhr.webp', '/sky/asr.webp', '/sky/maghrib.webp', '/sky/isha.webp',
  '/sky/fajr.jpg', '/sky/dhuhr.jpg', '/sky/asr.jpg', '/sky/maghrib.jpg', '/sky/isha.jpg'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL)
      .then(function(cache) { return cache.addAll(SHELL_INSTALL_PATHS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.indexOf('bilal-near-') === 0 && key !== SHELL && key !== DATA) {
          return caches.delete(key);
        }
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

function shellRequest(request) {
  return caches.match(request).then(function(hit) {
    var fresh = fetch(request).then(function(response) {
      if (response && response.ok) {
        caches.open(SHELL).then(function(cache) { cache.put(request, response.clone()); });
      }
      return response;
    });
    if (hit) {
      fresh.catch(function() {});
      return hit;
    }
    return fresh;
  });
}

/* Installed launches must never wait for the network before the first paint.
 * The exact page shell was cached at install time, so return it immediately
 * and refresh it quietly for the next launch. The previous network-first path
 * left iOS holding its operating-system launch frame on every slow connection. */
function pageRequest(request) {
  return caches.match('/near.html').then(function(hit) {
    var fresh = fetch(request).then(function(response) {
      if (!response || !response.ok) throw new Error('page unavailable');
      caches.open(SHELL).then(function(cache) { cache.put('/near.html', response.clone()); });
      return response;
    });
    if (hit) {
      fresh.catch(function() {});
      return hit;
    }
    return fresh.catch(function() { return caches.match('/near.html'); });
  });
}

function timesRequest(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      caches.open(DATA).then(function(cache) { cache.put(request, response.clone()); });
    }
    return response;
  }).catch(function() { return caches.match(request); });
}

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);

  if (url.hostname === TIMES_HOST && url.pathname.indexOf('/v1/times') === 0) {
    event.respondWith(timesRequest(event.request));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' &&
      (url.pathname === '/near' || url.pathname === '/near/' || url.pathname === '/near.html')) {
    event.respondWith(pageRequest(event.request));
    return;
  }

  if (SHELL_PATHS.indexOf(url.pathname) !== -1 || ON_DEMAND_PATHS.indexOf(url.pathname) !== -1) {
    event.respondWith(shellRequest(event.request));
  }
});

/* Notifications are emitted by the live Near page when its leave-time window
 * opens. Tapping one returns to the existing app window where possible, so a
 * notification never strands someone in a second copy of the same countdown. */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/near';
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(clients) {
      for (var i=0; i<clients.length; i++) {
        if (clients[i].url.indexOf('/near') !== -1) {
          if ('navigate' in clients[i]) clients[i].navigate(target);
          return clients[i].focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : null;
    })
  );
});
