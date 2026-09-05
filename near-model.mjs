import { core } from "./near-data.mjs";
import { clock, dayKey, dayWord, wallMinute } from "./near-time.mjs";
export { clock, dayWord };
export const prayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
export const minutesLabel = (n) => `${n} ${n === 1 ? "minute" : "minutes"}`;
export const distanceLabel = (n) =>
  n == null
    ? "Distance unavailable"
    : n < 1000
      ? `${Math.max(10, Math.round(n / 10) * 10)} m`
      : `${(n / 1000).toFixed(1)} km`;
export const journeyFor = (m, custom) =>
  Object.hasOwn(custom, m.id) ? custom[m.id] : m.walk;
export function mosqueFrom(source, result, now) {
  const rows = result.rows,
    audit = core.auditRows(rows),
    verdict = core.judge(rows, new Date(now * 60000), source);
  const schedule = [];
  for (const row of rows)
    for (const [i, p] of core.PRAYERS.entries()) {
      const date = core.effectiveJamaah(row.begins?.[p], row.jamaah?.[p]);
      if (date && Number.isFinite(+date) && !audit.bad[`${row.date}/${p}`])
        schedule.push({
          prayer: prayers[i],
          date: row.date,
          at: +date / 60000,
          key: `${source.g}|${row.date}|${p}`,
        });
    }
  schedule.sort((a, b) => a.at - b.at);
  const today = dayKey(now * 60000),
    row = rows.find((r) => r.date === today),
    walk = Number.isFinite(source._d)
      ? Math.max(1, Math.round((source._d * 1.3) / 0.08))
      : null;
  return {
    id: source.g,
    name: source.n,
    address: source.a || "",
    source,
    rows,
    schedule,
    verdict,
    audit,
    distance: Number.isFinite(source._d) ? source._d * 1000 : null,
    walk: walk != null && walk <= 30 ? walk : null,
    times: prayers.map(
      (p, i) =>
        schedule.find((s) => s.date === today && s.prayer === p)?.at ?? null,
    ),
    fetchedAt: result.fetchedAt,
    saved: result.saved,
    unconfirmed: verdict.why === "Times not confirmed by the mosque",
    usable:
      verdict.use || verdict.why === "Only a partial listing passed its checks",
  };
}
// The current prayer period comes from published begins times. A jama'ah's
// start does not move every other mosque into the next prayer period.
export function moment(pool, now) {
  let latest = null;
  for (const m of pool)
    for (const row of m.rows || [])
      for (const [i, p] of core.PRAYERS.entries()) {
        const at = row.begins?.[p];
        if (
          at &&
          Number.isFinite(+at) &&
          +at <= now * 60000 &&
          (!latest || +at > latest.at)
        )
          latest = { prayer: prayers[i], date: row.date, at: +at };
      }
  if (latest) return { now, prayer: latest.prayer, prayerDate: latest.date };
  // Without begins, use actual congregation starts to establish the period.
  const past = pool
    .flatMap((m) => m.schedule || [])
    .filter((o) => o.at <= now)
    .sort((a, b) => b.at - a.at)[0];
  return {
    now,
    prayer: past?.prayer || "Fajr",
    prayerDate: past?.date || dayKey(now * 60000),
  };
}
export function optionsFor(m, scenario) {
  if (!m.usable) return [];
  const current = m.schedule.find(
    (o) => o.prayer === scenario.prayer && o.date === scenario.prayerDate,
  );
  const next = m.schedule.find(
    (o) => o.at > scenario.now && o.key !== current?.key,
  );
  return [current, ...(current && current.at > scenario.now ? [] : [next])]
    .filter(Boolean)
    .map((o) => ({ ...o, mosque: m }));
}
export function recommend(pool, scenario, custom = {}) {
  const candidates = pool.flatMap((m) => optionsFor(m, scenario));
  // An unconfirmed timetable remains selectable. When choosing on the user's
  // behalf, prefer a checked listing that can still provide a next jama’ah.
  const checked = candidates.filter((o) => !o.mosque.unconfirmed);
  const all = checked.some((o) => o.at >= scenario.now - 15)
    ? checked
    : candidates;
  const same = all.filter(
    (o) =>
      o.prayer === scenario.prayer &&
      o.date === scenario.prayerDate &&
      o.at >= scenario.now - 15,
  );
  const before = same.filter(
    (o) => o.at >= scenario.now + (journeyFor(o.mosque, custom) ?? 0),
  );
  const byDistance = (a, b) =>
    (a.mosque.distance ?? Infinity) - (b.mosque.distance ?? Infinity) ||
    a.at - b.at;
  if (before.length) return before.sort(byDistance)[0];
  // A recently started congregation stays actionable. This is a ranking
  // window, never a published end time or a prohibition on travelling.
  if (same.length)
    return same.sort(
      (a, b) =>
        scenario.now +
          (journeyFor(a.mosque, custom) ?? 0) -
          a.at -
          (scenario.now + (journeyFor(b.mosque, custom) ?? 0) - b.at) ||
        byDistance(a, b),
    )[0];
  return (
    all
      .filter((o) => o.at > scenario.now)
      .sort((a, b) => a.at - b.at || byDistance(a, b))[0] || null
  );
}
export function describe(option, now, journey) {
  const until = Math.ceil(option.at - now),
    arrival = journey == null ? null : now + journey,
    leaveIn = journey == null ? null : Math.floor(option.at - now - journey);
  const day = dayWord(option.at, now),
    tomorrow = day === "tomorrow";
  let title,
    sub = "",
    kind = "countdown";
  if (option.at < now) {
    title = `${option.prayer} has started`;
    const elapsed = Math.floor(now - option.at);
    sub = `${elapsed < 1 ? "Started just now." : `Started ${elapsed} min ago.`} ${now - option.at < 15 ? "It may still be in progress." : "End time isn’t published."}`;
    kind = "started";
  } else if (until === 0) {
    title = `${option.prayer} starts now`;
    sub = "You can still head over.";
    kind = "started";
  } else if (day || until >= 60) {
    title = clock(option.at);
    kind = "time";
    sub = tomorrow
      ? "Tomorrow’s first jama’ah."
      : day
        ? `${day}’s jama’ah.`
        : `Starts in ${Math.floor(until / 60)} hr${until % 60 ? ` ${until % 60} min` : ""}.`;
  } else if (journey == null) {
    title = clock(option.at);
    kind = "time";
    sub = "Set your journey to see when to leave.";
  } else if (leaveIn < 0) {
    title = `${option.prayer} in ${until} min`;
    sub = `Your journey is about ${journey} min.`;
    kind = "late";
  } else if (leaveIn === 0) {
    title = "Time to go";
    sub = `${option.prayer} starts in ${until} min.`;
  } else title = `Leave in ${leaveIn} min`;
  const arrivalDifference =
    arrival == null ? null : Math.ceil(arrival - option.at);
  const departure = journey == null ? null : option.at - journey,
    leaveDay = departure == null ? "" : dayWord(departure, now);
  const journeyTitle =
    journey == null
      ? "How long is your journey?"
      : arrivalDifference > 0
        ? `Arrive around ${clock(arrival)}`
        : `Leave ${leaveDay ? leaveDay + " " : ""}by ${clock(departure)}`;
  return {
    title,
    sub,
    kind,
    until,
    day,
    tomorrow,
    arrival,
    leaveIn,
    arrivalDifference,
    journeyTitle,
  };
}
export function laterNearby(pool, selected, scenario) {
  if (
    selected.prayer === scenario.prayer &&
    selected.date === scenario.prayerDate &&
    selected.at > scenario.now
  )
    return null;
  return (
    pool
      .filter((m) => m.id !== selected.mosque.id)
      .flatMap((m) => optionsFor(m, scenario))
      .filter(
        (o) =>
          o.prayer === scenario.prayer &&
          o.date === scenario.prayerDate &&
          o.at > scenario.now,
      )
      .sort((a, b) => a.at - b.at)[0] || null
  );
}
export function resolveMosque({
  pool,
  scenario,
  custom = {},
  visit = null,
  usual = null,
}) {
  for (const [id, reason] of [
    [visit?.id, "visit"],
    [usual, "usual"],
  ]) {
    const m = pool.find((m) => m.id === id);
    if (!m) continue;
    const option = recommend([m], scenario, custom);
    if (option) return { option, reason };
  }
  return {
    option: recommend(pool, scenario, custom),
    reason: usual
      ? pool.some((m) => m.id === usual)
        ? "usual-unavailable"
        : "usual-away"
      : "nearby",
  };
}
