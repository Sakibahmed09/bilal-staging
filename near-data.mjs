import "./near-core.js";
import { dayKey, addDays, ukTime } from "./near-time.mjs";
export const core = globalThis.BilalNearCore;
export const TIMES = "https://bilal-times.ahmed-sakib.workers.dev/v1";
const PRAYERS = core.PRAYERS,
  pad = (n) => String(n).padStart(2, "0"),
  at = ukTime;
const fromISO = (v) => {
  if (!v) return null;
  if (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(v)
  )
    return ukTime(v.slice(0, 10), v.slice(11, 16));
  const d = new Date(v);
  return Number.isFinite(+d) ? d : null;
};
function shapeDashed(j) {
  // dashed-slug directory
  if (!j || !j.timetable || !j.timetable.length) return null;
  return j.timetable.map(function (r) {
    var q = r.iqamah || {};
    var out = {
      date: String(r.date || "").slice(0, 10),
      begins: {},
      jamaah: {},
    };
    PRAYERS.forEach(function (p) {
      out.begins[p] = fromISO(r[p]);
      out.jamaah[p] = fromISO(q[p]);
    });
    return out;
  });
}

/* Keyed the opposite way round: the top-level fields are the congregation
     and begin{} holds the start. Getting this backwards would put the athan
     on the wrong side of every prayer, so it is spelled out rather than
     inferred. Times arrive as bare "HH:MM" and are parsed as local wall time,
     which is right because a UK laptop runs on UK time. */
function shapeNumbered(days) {
  if (!days || !days.length) return null;
  return days.map(function (d) {
    var b = d.begin || {};
    var out = { date: d.date, begins: {}, jamaah: {} };
    PRAYERS.forEach(function (p) {
      out.begins[p] = at(d.date, b[p]);
      out.jamaah[p] = at(d.date, d[p]);
    });
    return out;
  });
}

/* Two parallel arrays of human strings, and it calls dhuhr "zuhr". Paired
     by their own date string rather than by index: the arrays have matched in
     every mosque seen, but pairing on index would shift the whole jama'ah
     column by a day the first time one had a gap. */
var MON = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
function ymd(s) {
  var m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/.exec(String(s || ""));
  if (!m || !MON[m[1]]) return null;
  return m[3] + "-" + pad(MON[m[1]]) + "-" + pad(parseInt(m[2], 10));
}
function hm12(v) {
  var m = /^(\d{1,2}):(\d{2})\s*([AaPp])/.exec(String(v || "").trim());
  if (!m) return null;
  var h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return pad(h) + ":" + m[2];
}
function shapeCoded(res) {
  if (!res || res.status !== "success" || !res.data) return null;
  var salah = res.data.salah || [],
    iq = res.data.iqamah || [];
  if (!salah.length) return null;
  var iqBy = {};
  iq.forEach(function (r) {
    var d = ymd(r.date);
    if (d) iqBy[d] = r;
  });
  var rows = [];
  salah.forEach(function (s) {
    var d = ymd(s.date);
    if (!d) return;
    var q = iqBy[d] || {};
    var out = { date: d, begins: {}, jamaah: {} };
    PRAYERS.forEach(function (p) {
      var k = p === "dhuhr" ? "zuhr" : p;
      out.begins[p] = at(d, hm12(s[k]));
      out.jamaah[p] = at(d, hm12(q[k]));
    });
    rows.push(out);
  });
  return rows.length ? rows : null;
}

/* A whole year in one reply, rows keyed by day and month with no year, and
     begins and jama'ah sitting side by side in the same row. Only the days
     this page actually asks about are built, and each is looked up by its own
     day and month — so the 29 February row that is always present simply goes
     unread in a year that does not have one. */
function shapeYearly(res, from, to) {
  var m = res && res.model;
  if (!m || res.hasError) return null;
  var year = m.salahTimings || [];
  if (!year.length) return null;
  var by = {};
  year.forEach(function (r) {
    if (r && r.month && r.day) by[pad(r.month) + "-" + pad(r.day)] = r;
  });
  var BEGIN = {
    fajr: "fajr",
    dhuhr: "zuhr",
    asr: "asr",
    maghrib: "maghrib",
    isha: "isha",
  };
  var IQ = {
    fajr: "iqamah_Fajr",
    dhuhr: "iqamah_Zuhr",
    asr: "iqamah_Asr",
    maghrib: "iqamah_Maghrib",
    isha: "iqamah_Isha",
  };
  var rows = [],
    d = ukTime(from, "12:00"),
    end = ukTime(to, "12:00");
  while (d <= end) {
    var ds = dayKey(d),
      r = by[pad(d.getMonth() + 1) + "-" + pad(d.getDate())];
    if (r) {
      var out = { date: ds, begins: {}, jamaah: {} };
      PRAYERS.forEach(function (p) {
        out.begins[p] = at(ds, r[BEGIN[p]]);
        out.jamaah[p] = at(ds, r[IQ[p]]);
      });
      rows.push(out);
    }
    d = ukTime(addDays(dayKey(d), 1), "12:00");
  }
  return rows.length ? rows : null;
}

export function normalizeTimes(id, payload, from, to) {
  let rows = /^mosque-\d+$/i.test(id)
    ? shapeNumbered(payload)
    : /^(?=.*[A-Z0-9])[A-Za-z0-9]{8}$/.test(id)
      ? shapeCoded(payload)
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          )
        ? shapeYearly(payload, from, to)
        : shapeDashed(payload);
  return (rows || [])
    .filter(
      (r) =>
        /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= from && r.date <= to,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function reviveRows(rows) {
  return (rows || []).map((r) => ({
    date: r.date,
    ...Object.fromEntries(
      ["begins", "jamaah"].map((kind) => [
        kind,
        Object.fromEntries(PRAYERS.map((p) => [p, fromISO(r[kind]?.[p])])),
      ]),
    ),
  }));
}
export class NearError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}
export async function requestJSON(
  url,
  { signal, fetcher = fetch, timeout = 12000 } = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new NearError("timeout")),
    timeout,
  );
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-cache",
    });
    if (!response.ok) throw new NearError("network", `HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
// Only public timetable data is cached here, never GPS or geocoding queries.
// Keep a bounded working set across app-shell updates and calendar changes.
export function timetableCache(storage = globalThis.caches) {
  const name = "bilal-near-timetables-v1";
  const key = (id) =>
    new URL(
      `__near-times/${encodeURIComponent(id)}`,
      globalThis.location?.href || "https://bilalathan.co.uk/",
    ).href;
  return {
    async get(id) {
      try {
        return await (await (await storage.open(name)).match(key(id)))?.json();
      } catch {
        return null;
      }
    },
    async put(id, value) {
      try {
        const cache = await storage.open(name);
        await cache.delete(key(id));
        await cache.put(
          key(id),
          new Response(JSON.stringify(value), {
            headers: { "Content-Type": "application/json" },
          }),
        );
        const keys = await cache.keys();
        await Promise.all(
          keys
            .slice(0, Math.max(0, keys.length - 16))
            .map((k) => cache.delete(k)),
        );
      } catch {}
    },
  };
}
export function createDataService({
  fetcher = globalThis.fetch,
  cache = timetableCache(),
  now = Date.now,
} = {}) {
  let directoryPromise;
  const inFlight = new Map(),
    memory = new Map();
  async function directory({ signal } = {}) {
    if (!directoryPromise)
      directoryPromise = requestJSON(new URL("mosques.json", import.meta.url), {
        fetcher,
      })
        .then((list) => {
          if (!Array.isArray(list)) throw new NearError("directory");
          return list.filter(
            (m) =>
              typeof m.g === "string" &&
              typeof m.n === "string" &&
              m.y != null &&
              m.x != null &&
              Number.isFinite(Number(m.y)) &&
              Number.isFinite(Number(m.x)),
          );
        })
        .catch((e) => {
          directoryPromise = null;
          throw e;
        });
    const list = await directoryPromise;
    if (signal?.aborted) throw signal.reason;
    return list;
  }
  async function times(id, { signal, force = false } = {}) {
    const today = dayKey(now()),
      from = addDays(today, -1),
      to = addDays(today, 2),
      key = id + "|" + today;
    const hit = memory.get(key);
    if (!force && hit && now() - hit.fetchedAt < 60000) return hit;
    // A request cancelled by a previous area never owns a subsequent request.
    if (!signal && !force && inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      try {
        const payload = await requestJSON(
          `${TIMES}/times?id=${encodeURIComponent(id)}&from=${from}&to=${to}`,
          { signal, fetcher },
        );
        const rows = normalizeTimes(id, payload, from, to);
        if (!rows.length) throw new NearError("empty");
        const result = { rows, fetchedAt: now(), saved: false };
        memory.set(key, result);
        await cache.put(id, { version: 1, ...result });
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        // A successful empty response is authoritative; do not replace it
        // with an older timetable whose publication has been withdrawn.
        if (error.code === "empty") throw error;
        const previous = await cache.get(id);
        if (
          previous?.version === 1 &&
          Array.isArray(previous.rows) &&
          Number.isFinite(previous.fetchedAt) &&
          now() - previous.fetchedAt >= 0 &&
          now() - previous.fetchedAt <= 48 * 3600000
        ) {
          const rows = reviveRows(previous.rows).filter(
            (r) => r.date >= from && r.date <= to,
          );
          if (rows.some((r) => r.date >= today))
            return { rows, fetchedAt: previous.fetchedAt, saved: true };
        }
        throw new NearError("network");
      }
    })();
    if (!signal) inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  }
  async function geocode(query, { signal } = {}) {
    const clean = String(query || "")
      .trim()
      .replace(/\s+/g, " ");
    if (clean.length < 2) throw new NearError("query");
    const data = await requestJSON(
      TIMES + "/geocode?q=" + encodeURIComponent(clean),
      { signal, fetcher },
    );
    return (data?.results || []).filter(
      (p) =>
        p.lat != null &&
        p.lng != null &&
        Number.isFinite(Number(p.lat)) &&
        Number.isFinite(Number(p.lng)),
    );
  }
  return { directory, times, geocode };
}
export function locate({
  geolocation = globalThis.navigator?.geolocation,
  signal,
  fresh = false,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new NearError("location"));
      return;
    }
    let ended = false;
    const finish = (fn, value) => {
      if (ended) return;
      ended = true;
      signal?.removeEventListener("abort", abort);
      fn(value);
    };
    const abort = () => finish(reject, new NearError("cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    geolocation.getCurrentPosition(
      (p) =>
        finish(resolve, { lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        finish(reject, new NearError(e.code === 1 ? "permission" : "location")),
      {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: fresh ? 0 : 600000,
      },
    );
  });
}
export function distance(a, b) {
  const p = Math.PI / 180,
    x = (Number(b.y) - a.lat) * p,
    y = (Number(b.x) - a.lng) * p;
  const h =
    Math.sin(x / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(Number(b.y) * p) * Math.sin(y / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function nearby(list, here, remembered = []) {
  const ranked = list
    .map((m) => ({ ...m, _d: distance(here, m) / 1000 }))
    .filter((m) => m._d <= 60)
    .sort((a, b) => a._d - b._d);
  const first = ranked.slice(0, 8);
  for (const id of remembered) {
    const mosque = ranked.find((m) => m.g === id && m._d <= 2);
    if (mosque && !first.some((m) => m.g === id)) first.push(mosque);
  }
  return first;
}
