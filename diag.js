/* ─────────────────────────────────────────────────────────────────────────
 * Bilal diagnostics.
 *
 * Built because the worst failures this product has produced were ones nobody
 * could report. A black rectangle on a wall is indistinguishable from the
 * television being switched off. An empty prayer rail looks like the mosque
 * has not published. A mosque wrongly labelled "no jama'ah times" looks like
 * the mosque's fault. In every one of those the person sees nothing worth
 * filing a bug about, so waiting to be told is waiting forever.
 *
 * So this does three things, in descending order of how much it matters:
 *
 *   1. Catches thrown errors and unhandled rejections on its own.
 *   2. Sends a heartbeat, so a screen that goes quiet is itself the signal.
 *   3. Makes a person's own report one tap, with the state already attached.
 *
 * Everything it reads is observable from the DOM: the status line, the audio
 * line, whether the shell revealed, how many times are on the rail. It is
 * deliberately not wired into the display's internals, so refactoring the
 * display cannot quietly stop diagnostics working.
 *
 * The device id is a random string in localStorage, scoped to one browser on
 * one screen. It is there so someone can quote it from across a room. It is
 * not a user identifier and carries nothing personal.
 * ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var SB  = 'https://vstfgrlkwqevonrznzwm.supabase.co/rest/v1/bilal_reports';
  var SBK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdGZncmxrd3Fldm9ucnpuendtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MDAwOTUsImV4cCI6MjA4OTk3NjA5NX0.IjPhlACgy3xslF9EvhKeIemoobHKR02LXcEgiKYHdYg';

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no O/0, no I/1: it gets read aloud
  var errors = [];
  var MAX_ERRORS = 8;

  function deviceId() {
    try {
      var id = localStorage.getItem('bilal.did');
      if (id) return id;
      id = '';
      for (var i = 0; i < 6; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      localStorage.setItem('bilal.did', id);
      return id;
    } catch (e) { return 'NOSTORE'; }
  }

  function text(id) {
    try { var el = document.getElementById(id); return el ? el.textContent.trim() : null; }
    catch (e) { return null; }
  }

  function page() {
    var p = location.pathname.replace(/^.*\//, '') || 'index.html';
    return p.replace(/\.html$/, '');
  }

  /* What kind of screen this is, in the words a person would use rather than a
     user-agent string. The full UA goes in too, but "Fire TV" is what makes a
     report readable at a glance. */
  function device() {
    var ua = navigator.userAgent || '';
    if (/AFT[A-Z0-9]/i.test(ua))          return 'Fire TV';
    if (/Echo|AEO[A-Z]/i.test(ua))        return 'Echo Show';
    if (/KF[A-Z]{2}/i.test(ua))           return 'Fire tablet';
    if (/Silk/i.test(ua))                 return 'Amazon Silk';
    if (/iPhone|iPod/i.test(ua))          return 'iPhone';
    if (/iPad/i.test(ua))                 return 'iPad';
    if (/Android.*Mobile/i.test(ua))      return 'Android phone';
    if (/Android/i.test(ua))              return 'Android tablet';
    return 'desktop';
  }

  function config() {
    try { return JSON.parse(localStorage.getItem('bilal.config') || 'null'); }
    catch (e) { return null; }
  }

  /* How old the cached timetable is, and whether it still covers today. The
     second half is the one that matters: a cache can be recent and still have
     run out of days. */
  function cache(cfg) {
    if (!cfg || !cfg.slug) return null;
    try {
      var c = JSON.parse(localStorage.getItem('bilal.tt.' + cfg.slug) || 'null');
      if (!c || !c.j) return { present: false };
      var d = new Date(), k = d.getFullYear() + '-' +
        ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      var rows = (c.j.timetable || []);
      var hasToday = false;
      for (var i = 0; i < rows.length; i++)
        if (String(rows[i].date).slice(0, 10) === k) { hasToday = true; break; }
      return { present: true, ageHours: Math.round((Date.now() - c.t) / 3600000),
               days: rows.length, coversToday: hasToday };
    } catch (e) { return { present: false, error: true }; }
  }

  /* ── "the device falls asleep" ──────────────────────────────────────────
     There is no API that reports a television going to sleep, so this infers
     it. A timer set for 20s that fires 90s late means the machine was not
     running: it slept, or the browser was suspended, or the tab was frozen.
     Recording those gaps is the only way that failure is ever provable, and it
     is the one Fire TV complaint we expect most. */
  var lastTick = Date.now(), gaps = [], hides = 0, started = Date.now();
  setInterval(function () {
    var now = Date.now(), late = now - lastTick - 20000;
    if (late > 70000 && gaps.length < 20) {
      gaps.push({ at: new Date(lastTick).toISOString(), minutes: Math.round(late / 60000) });
    }
    lastTick = now;
  }, 20000);
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) hides++;
    });
  } catch (e) {}

  /* ── "it was just gone" ─────────────────────────────────────────────────
     The gap detector above only survives if the PAGE survives. On the evening
     of 16 Aug the display ran 13 hours clean, stopped dead between 18:25 and
     23:42, and missed maghrib and isha in silence. Nothing above could report
     that, because a page cannot describe its own death: server-side the screen
     simply went quiet, which is indistinguishable from the telly being off.

     So the NEXT instance files the report. A stamp goes down every 30s, and a
     fresh boot that finds a recent one knows exactly how long the screen was
     missing. The breadcrumb next to it is the part that matters: the browser
     announces most of the ways it can take a page away, and which announcement
     arrived last separates them —

       'freeze'    the browser froze the page (lifecycle, reclaimable)
       'pagehide'  it was navigated away from or unloaded
       'hidden'    it was backgrounded first, e.g. Alexa took the screen
       none        killed outright: process death, OOM, or the device rebooted

     Only the last of those is a device-level event, so this is what decides
     whether the fix belongs in the page or in the Echo's settings. */
  var ALIVE = 'bilal.alive', LASTEV = 'bilal.lastEvent';
  function stamp(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function readNum(k) { try { return parseInt(localStorage.getItem(k), 10) || 0; } catch (e) { return 0; } }
  var priorAlive = readNum(ALIVE);
  var priorEvent = (function () { try { return localStorage.getItem(LASTEV); } catch (e) { return null; } })();
  stamp(ALIVE, Date.now());
  setInterval(function () { stamp(ALIVE, Date.now()); }, 30000);
  ['freeze', 'pagehide'].forEach(function (ev) {
    try { global.addEventListener(ev, function () { stamp(LASTEV, ev + '@' + Date.now()); }); } catch (e) {}
  });
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stamp(LASTEV, 'hidden@' + Date.now());
    });
  } catch (e) {}

  /* Five minutes, not thirty: a reload takes seconds, so anything past five is
     a real absence rather than someone pressing refresh. A device with no prior
     stamp is genuinely new and has nothing to report. */
  function outage() {
    if (!priorAlive) return null;
    var min = Math.round((Date.now() - priorAlive) / 60000);
    if (min < 5) return null;
    return { minutes: min, lastAlive: new Date(priorAlive).toISOString(),
             lastEvent: priorEvent || 'none' };
  }

  /* ── "the screen flickers" ──────────────────────────────────────────────
     Flicker is a report, not a measurement, and the device it happens on is one
     nobody can attach a profiler to. So the screen times its own frames and
     says how bad it was, which turns somebody squinting at a wall into a number
     per device that can be compared before and after a change.

     Sampled in bursts rather than continuously: a permanent requestAnimationFrame
     loop on a low-power device would be measuring something it had itself made
     worse. Five seconds every five minutes is representative and close to free. */
  var frames = { samples: 0, long: 0, worstMs: 0 };
  function sampleFrames() {
    var last = 0, seen = 0;
    function tick(t) {
      if (last) {
        var d = t - last;
        frames.samples++;
        if (d > 100) frames.long++;                 // a visible stutter
        if (d > frames.worstMs) frames.worstMs = Math.round(d);
      }
      last = t;
      if (++seen < 300) requestAnimationFrame(tick);
    }
    try { requestAnimationFrame(tick); } catch (e) {}
  }
  setTimeout(sampleFrames, 30000);
  setInterval(sampleFrames, 5 * 60 * 1000);

  /* ── "I can't hear the athan" ───────────────────────────────────────────
     The distinction that decides who has the problem: did the browser REFUSE
     to play, or did it play and nobody heard it. The first is ours. The second
     is the television's volume, and no amount of our code fixes it. The
     display already records both outcomes on window.__bilal, so read that
     rather than guessing from the status line.

     There is a THIRD outcome, and it is the one that cost a morning: the browser
     accepts the play, resolves the promise, and no sound comes out. Reported as
     'played, so check the TV volume', it sends the owner to hunt a fault in
     their television that is actually ours. `heard` is the measurement that
     separates it: the media clock either advanced or it did not. */
  function audio() {
    var b = global.__bilal || {};
    var el = document.getElementById('audioState');
    var out = {
      line: el ? el.textContent.trim() : null,
      unlocked: b.unlock || null,          // 'ok' means a play() actually resolved
      heard: b.heard || null,              // 'yes' means the media clock ran
      playedMs: typeof b.playedMs === 'number' ? b.playedMs : null,
      athanAttempts: b.calls || 0,
      cueAttempts: b.cues || 0,
      // The Silk keep-awake counter has always existed and was never sent, so a
      // screen that quietly stopped nudging looked exactly like one that never
      // needed to. Zero here on a long-lived screen is a finding, not a default.
      silkNudges: b.silkNudges || 0,
      lastError: b.lastError ? String(b.lastError).slice(0, 200) : null
    };
    /* `heard` may be absent, and absent is NOT the same as bad. diag.js and
       index.html are separate files on the same origin, so a browser can hold a
       new diag beside an older cached display that never sets it. An unmeasured
       screen keeps the old verdict rather than being downgraded, because
       inventing a fault we did not measure is the same sin as the one this
       field was added to fix. */
    out.verdict =
      out.athanAttempts > 0 && out.heard === 'no-progress'
        ? 'played but no sound came out, ours to fix'
        : /BLOCKED/.test(out.unlocked || '') || out.unlocked === 'refused'
          ? 'browser refused to play, ours to fix'
          : out.unlocked === 'ok' && out.athanAttempts > 0
            ? (out.heard === 'yes'
                ? 'played and the clock ran, so check the TV volume'
                : 'played, so check the TV volume')
            : out.athanAttempts === 0
              ? 'has not tried yet today'
              : 'unproven';
    return out;
  }

  /* ── "those aren't my mosque's times" ───────────────────────────────────
     Capture what is actually on the screen, not what we believe should be, so
     it can be held against the card on the mosque wall without anyone needing
     to reproduce anything. The slug is what identifies who to complain to. */
  function times() {
    var rail = document.getElementById('rail');
    if (!rail) return null;
    var rows = [], seen = {};
    try {
      var cells = rail.querySelectorAll('div');
      for (var i = 0; i < cells.length && rows.length < 5; i++) {
        var t = cells[i].textContent.replace(/\s+/g, ' ').trim();
        // Must name a prayer AND carry a time: the rail nests, so matching on
        // the name alone returns the wrapper and its own label as two rows.
        if (!/^(fajr|dhuhr|asr|maghrib|isha)/i.test(t)) continue;
        if (!/\d{1,2}:\d{2}/.test(t) || t.length > 60) continue;
        var key = t.slice(0, 6).toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        rows.push(t);
      }
    } catch (e) {}
    var head = document.getElementById('prayerName');
    var sub  = document.getElementById('prayerSub') || document.getElementById('countdown');
    return {
      shown: rows,
      headline: head ? head.textContent.trim() : null,
      under: sub ? sub.textContent.trim() : null
    };
  }

  function snapshot() {
    var cfg = config();
    var shell = document.getElementById('shell');
    var rail  = document.getElementById('rail');
    return {
      audio: audio(),
      times: times(),
      /* longPct is the number to watch: what share of frames took over 100ms.
         A healthy screen is near zero. Anything in double figures is visible
         as stutter from across a room. */
      frames: { samples: frames.samples, long: frames.long, worstMs: frames.worstMs,
                longPct: frames.samples ? Math.round(100 * frames.long / frames.samples) : null,
                lite: /[?&]lite=1/.test(location.search) },
      asleep: { gaps: gaps.slice(), timesHidden: hides,
                uptimeMin: Math.round((Date.now() - started) / 60000) },
      /* ── "the screen went dark" ────────────────────────────────────────
         The failure this was added for looks like nothing else in here: the
         page is perfectly healthy and the panel is black. On 16 Aug an Echo
         Show ran all night with unbroken heartbeats, rAF at full rate and zero
         errors, and showed the owner a dark screen. Everything above answers
         "is the page alive", and every one of them said yes.

         So these two are deliberately about the panel, not the page:
         `state` is the wake lock's real outcome (held / refused / released /
         absent / idle), which used to be swallowed by an empty catch, and
         `vid` says whether the keep-awake video is genuinely playing or
         merely play()-accepted and paused, which is a distinction that has
         already cost one morning on this project.

         Absent on an older cached display, same as `heard` above: report null
         rather than inventing a verdict we did not measure. */
      /* Null on a screen that simply kept running, which is the common case
         and should not read as a finding. */
      outage: outage(),
      awake: (function () {
        var b = global.__bilal || {};
        if (!b.wakeLock && !b.vid) return null;
        return { lock: b.wakeLock || null, vid: b.vid || null };
      })(),
      at: new Date().toISOString(),
      tzOffsetMin: new Date().getTimezoneOffset(),
      device: device(),
      ua: (navigator.userAgent || '').slice(0, 300),
      viewport: (innerWidth || 0) + 'x' + (innerHeight || 0),
      screen: ((screen && screen.width) || 0) + 'x' + ((screen && screen.height) || 0),
      dpr: global.devicePixelRatio || 1,
      url: location.href.slice(0, 300),
      online: navigator.onLine !== false,
      mosque: cfg ? { slug: cfg.slug, name: cfg.name, walk: cfg.walk } : null,
      cache: cache(cfg),
      /* The three lines that would have caught 9 August's failures without
         anyone filing anything: did the shell ever become visible, does the
         rail actually have times on it, and what does the status line claim. */
      shellRevealed: shell ? shell.classList.contains('go') : null,
      railTimes: rail ? (rail.textContent.match(/\d{1,2}:\d{2}/g) || []).length : null,
      status: text('statText'),
      errors: errors.slice()
    };
  }

  /* asDevice lets a phone file a report against the screen it is complaining
     about, so a person's words land beside that screen's own heartbeats and
     errors instead of beside the phone's. The phone's own id is kept in diag
     so the two are never confused. */
  /* Embedded copies must not report. tv.html's desktop hero and hours.html
     both run this page inside iframes; each would otherwise register as a
     real screen in the fleet table — heartbeats from every landing-page
     visit, drowning the signal the table exists for ("a screen that stops
     reporting IS the signal"). Snapshots still work; only the network stops. */
  /* Staging counts as embedded for the same reason ?demo=1 does: it writes to
     the SAME reports table as production, so every test load became a real
     screen in the fleet. That table is the instrument the "is anything dark"
     question is answered from, and a phantom desktop sitting in it for three
     days is a false reading in exactly the place we can least afford one.
     Caught on 16 Aug while using staging to verify a wake-lock fix — four
     rows, one imaginary screen. Matching on the staging repo path rather than
     the host, because the host also serves the public gh-pages site. */
  var STAGING = /\/bilal-staging\//.test(location.pathname);
  var EMBEDDED = /[?&](demo|nodiag)=1/.test(location.search) || STAGING;

  /* note() caps what a report CARRIES; this caps what a fault SENDS. The
     display's render loop runs every second, so one throwing frame used to
     mean a Supabase row per second until someone pulled the plug — 86k rows
     a day from a single broken screen. Six an hour says everything a stream
     would have said. */
  var errSentAt = [];
  function errBudget() {
    var now = Date.now();
    errSentAt = errSentAt.filter(function (t) { return now - t < 3600000; });
    if (errSentAt.length >= 6) return false;
    errSentAt.push(now);
    return true;
  }

  function send(kind, message, asDevice) {
    if (EMBEDDED) return Promise.resolve();
    if (kind === 'error' && !errBudget()) return Promise.resolve();
    var diag = snapshot();
    if (asDevice) diag.reportedFrom = deviceId();
    var body = {
      kind: kind, device_id: asDevice || deviceId(), page: page(),
      message: message || null, diag: diag
    };
    try {
      return fetch(SB, {
        method: 'POST', keepalive: true,
        headers: { 'apikey': SBK, 'Authorization': 'Bearer ' + SBK,
                   'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      });
    } catch (e) { return Promise.resolve(); }
  }

  function note(where, msg, extra) {
    if (errors.length >= MAX_ERRORS) return;      // a loop must not become a flood
    errors.push({ where: where, msg: String(msg).slice(0, 300), extra: extra || null,
                  at: new Date().toISOString() });
  }

  global.addEventListener('error', function (e) {
    note('error', e.message, (e.filename || '').replace(/^.*\//, '') + ':' + e.lineno);
    send('error', e.message);
  });
  global.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    note('rejection', (r && r.message) || r);
    send('error', 'unhandled rejection: ' + ((r && r.message) || r));
  });

  /* A screen that stops reporting is the signal. Half-hourly is often enough to
     notice a display that died overnight and rare enough that a handful of
     screens will not fill a table. */
  setTimeout(function () { send('heartbeat'); }, 20000);
  setInterval(function () { send('heartbeat'); }, 30 * 60 * 1000);

  /* Its own row, and early, rather than riding the next heartbeat. A screen
     that has just come back from being missing is the one moment worth an
     immediate report, and query 2 in ops.sql groups by kind — an outage buried
     inside a routine heartbeat would be found only by someone already looking
     for it, which is the whole failure this is meant to end. */
  setTimeout(function () {
    var o = outage();
    if (o) send('restart', 'gone ' + o.minutes + ' min, last event: ' + o.lastEvent);
  }, 22000);

  global.BilalDiag = { id: deviceId, snapshot: snapshot, send: send, note: note };
})(this);
