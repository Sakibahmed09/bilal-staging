// Directory times are UK wall times, even when the phone is in another zone.
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const dayKey = (date) => dateFormat.format(new Date(date));
export const clock = (minute) => timeFormat.format(new Date(minute * 60000));
export const wallMinute = (date) => {
  const [h, m] = timeFormat.format(new Date(date)).split(":").map(Number);
  return h * 60 + m;
};
export function addDays(key, days) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function ukTime(date, time) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
    !/^\d{1,2}:\d{2}$/.test(time || "")
  )
    return null;
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const raw = Date.parse(
    `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
  );
  if (!Number.isFinite(raw)) return null;
  // Try GMT, then BST, and reject nonexistent spring-forward wall times.
  for (const offset of [0, 3600000]) {
    const value = new Date(raw - offset);
    if (dayKey(value) === date && wallMinute(value) === h * 60 + m)
      return value;
  }
  return null;
}
export function dayWord(at, now) {
  const date = dayKey(at * 60000),
    today = dayKey(now * 60000);
  if (date === today) return "";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date === addDays(today, -1)) return "yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(at * 60000));
}
