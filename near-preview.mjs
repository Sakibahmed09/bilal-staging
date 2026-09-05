// Explicit screenshot and interaction fixtures. This module is never loaded
// by a normal visit and never calls GPS, timetable or geocoding services.
import { ukTime, dayKey, addDays } from "./near-time.mjs";
export async function startPreview(session, now, state = "") {
  document.documentElement.dataset.preview = "true";
  const sources = [
    {
      g: "preview-shoreditch",
      n: "Shoreditch Masjid",
      a: "53 Redchurch Street",
      y: 51.5256,
      x: -0.073,
      v: 1,
    },
    {
      g: "preview-burhan",
      n: "Burhan Uddin Mosque",
      a: "8 Buckfast Street",
      y: 51.5269,
      x: -0.0688,
      v: 1,
    },
    {
      g: "preview-dorset",
      n: "Dorset Masjid",
      a: "Diss Street",
      y: 51.5294,
      x: -0.0647,
      v: 1,
    },
  ];
  const today = dayKey(now),
    begins = ["05:00", "13:00", "16:45", "19:42", "20:50"];
  const times = [
    ["05:40", "13:30", "18:00", "19:42", "21:15"],
    ["05:45", "13:35", "18:15", "19:42", "21:20"],
    ["05:30", "13:20", "18:10", "19:42", null],
  ];
  const keys = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  session.data.directory = async () => sources;
  session.data.times = async (id) => ({
    fetchedAt: now,
    saved: state === "offline",
    rows: [-1, 0, 1, 2].map((offset) => {
      const date = addDays(today, offset),
        index = sources.findIndex((m) => m.g === id);
      return {
        date,
        begins: Object.fromEntries(
          keys.map((p, i) => [p, ukTime(date, begins[i])]),
        ),
        jamaah: Object.fromEntries(
          keys.map((p, i) => [p, ukTime(date, times[Math.max(0, index)][i])]),
        ),
      };
    }),
  });
  session.data.geocode = async (query) =>
    query.toLowerCase().includes("zz")
      ? []
      : [
          {
            label: "Brick Lane",
            detail: "Tower Hamlets, London",
            lat: 51.5257,
            lng: -0.072,
          },
          {
            label: "Shoreditch",
            detail: "Hackney, London",
            lat: 51.526,
            lng: -0.074,
          },
        ];
  await session.start({
    place: { lat: 51.5257, lng: -0.072, label: "Brick Lane" },
  });
  if (
    [
      "locate",
      "loading",
      "permission",
      "location",
      "empty",
      "failure",
    ].includes(state)
  )
    session.state.screen = state;
  if (state === "offline") session.state.notice = "offline";
  if (state === "unknown") {
    session.state.pool.forEach((m) => (m.walk = null));
  }
  if (state === "long") {
    session.state.selected.mosque.name =
      "Bethnal Green Islamic Cultural Centre and Mosque";
    session.state.area = "Bethnal Green and Cambridge Heath";
  }
}
