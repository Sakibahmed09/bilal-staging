import { core } from "./near-data.mjs";
import { dayKey, wallMinute } from "./near-time.mjs";
// Fallback colour anchors are used only until a location is available.
export const LIGHT_ANCHORS = [
  { at: 0, sky: "isha", cloud: 0.045, stars: 0.26, spark: 0.56 },
  { at: 240, sky: "isha", cloud: 0.05, stars: 0.26, spark: 0.56 },
  { at: 330, sky: "fajr", cloud: 0.095, stars: 0.08, spark: 0.16 },
  { at: 450, sky: "dhuhr", cloud: 0.16, stars: 0, spark: 0 },
  { at: 810, sky: "dhuhr", cloud: 0.18, stars: 0, spark: 0 },
  { at: 1040, sky: "asr", cloud: 0.17, stars: 0, spark: 0 },
  { at: 1182, sky: "maghrib", cloud: 0.15, stars: 0.025, spark: 0.03 },
  { at: 1290, sky: "isha", cloud: 0.045, stars: 0.26, spark: 0.56 },
  { at: 1440, sky: "isha", cloud: 0.045, stars: 0.26, spark: 0.56 },
];
const mix = (a, b, p) => a + (b - a) * p;
export function lightAt(minutes, anchors = LIGHT_ANCHORS) {
  const minute = Number.isFinite(minutes)
    ? ((minutes % 1440) + 1440) % 1440
    : 0;
  const index = anchors.findIndex(
    (a, i) =>
      i < anchors.length - 1 && minute >= a.at && minute < anchors[i + 1].at,
  );
  const from = anchors[Math.max(0, index)],
    to = anchors[Math.max(0, index) + 1];
  const t = (minute - from.at) / (to.at - from.at),
    p = t * t * (3 - 2 * t);
  const weights = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
  weights[from.sky] += 1 - p;
  weights[to.sky] += p;
  const dawnAnchor = anchors.find((a) => a.sky === "fajr")?.at || 330;
  const dawn = (minute - (dawnAnchor - 60)) / 150;
  const warmth =
    dawn > 0 && dawn < 1 ? Math.sin(Math.PI * dawn) ** 2 * 0.14 : 0;
  return {
    minute,
    weights,
    warmth,
    phase: p < 0.5 ? from.sky : to.sky,
    cloud: mix(from.cloud, to.cloud, p),
    stars: mix(from.stars, to.stars, p),
    spark: mix(from.spark, to.spark, p),
  };
}
export function prayerAt(minute) {
  if (minute < 300) return "Fajr";
  if (minute < 780) return "Fajr";
  if (minute < 990) return "Dhuhr";
  if (minute < 1182) return "Asr";
  if (minute < 1260) return "Maghrib";
  return "Isha";
}

// Image layers share one composition. Cumulative alpha keeps each blend fully
// covered; naively fading both layers would dim the middle of every transition.
export function layerOpacities(weights, keys) {
  let mass = 0;
  return keys.map((key) => {
    const weight = weights[key] || 0;
    mass += weight;
    return mass > 0 ? weight / mass : 0;
  });
}

export function createAtmosphere({ root, layers, reduced }) {
  const keys = ["isha", "fajr", "dhuhr", "asr", "maghrib"];
  const elements = keys.map((key) => {
    const el = document.createElement("div");
    el.className = "sky-layer";
    el.dataset.tone = key;
    el.style.backgroundImage = `url(sky/${key}.webp)`;
    layers.append(el);
    return el;
  });
  let anchors = LIGHT_ANCHORS;
  let target = lightAt(0),
    current = { ...target.weights },
    frame = 0,
    previous = 0,
    paused = false,
    ready = false;
  const emit = (weights, values) => {
    layerOpacities(weights, keys).forEach((alpha, i) => {
      elements[i].style.opacity = alpha.toFixed(5);
    });
    root.style.setProperty("--cloud-opacity", values.cloud.toFixed(4));
    root.style.setProperty("--star-opacity", values.stars.toFixed(4));
    root.style.setProperty("--spark-opacity", values.spark.toFixed(4));
    root.style.setProperty("--dawn-warmth", values.warmth.toFixed(4));
  };
  let currentValues = {
    cloud: target.cloud,
    stars: target.stars,
    spark: target.spark,
    warmth: target.warmth,
  };
  function settle() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    current = { ...target.weights };
    currentValues = {
      cloud: target.cloud,
      stars: target.stars,
      spark: target.spark,
      warmth: target.warmth,
    };
    emit(current, currentValues);
    root.dataset.lightSettled = "true";
  }
  function tick(now) {
    frame = 0;
    if (paused || reduced.matches) {
      settle();
      return;
    }
    const dt = previous ? Math.min(64, now - previous) : 16;
    previous = now;
    const rate = 1 - Math.exp(-dt / 175);
    let difference = 0;
    for (const key of keys) {
      current[key] = mix(current[key], target.weights[key], rate);
      difference += Math.abs(current[key] - target.weights[key]);
    }
    for (const key of ["cloud", "stars", "spark", "warmth"])
      currentValues[key] = mix(currentValues[key], target[key], rate);
    emit(current, currentValues);
    if (difference > 0.0003) frame = requestAnimationFrame(tick);
    else settle();
  }
  function setTime(minute, { immediate = false } = {}) {
    target = lightAt(minute, anchors);
    root.dataset.lightSettled = "false";
    root.dataset.sky = target.phase;
    root.dataset.lightMinute = String(Math.round(target.minute));
    document.documentElement.style.setProperty(
      "--near-sky",
      `url(sky/${target.phase}.webp)`,
    );
    document
      .querySelector("meta[name=theme-color]")
      ?.setAttribute(
        "content",
        document.documentElement.classList.contains("sheet-open")
          ? "#252a21"
          : "#191b16",
      );
    if (!ready || immediate || paused || reduced.matches) {
      ready = true;
      settle();
    } else if (!frame) {
      previous = 0;
      frame = requestAnimationFrame(tick);
    }
  }
  function setPaused(value) {
    paused = value;
    root.classList.toggle("atmosphere-paused", value);
    if (value) settle();
  }
  function onPreference() {
    if (reduced.matches) settle();
  }
  reduced.addEventListener("change", onPreference);
  // Load the five tiny colour grades together, so a scrub never reveals an
  // unloaded layer. A failing grade leaves the already visible photograph.
  Promise.all(
    elements.map(
      (el, i) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = `sky/${keys[i]}.webp`;
        }),
    ),
  ).then((results) => {
    const fallback = keys[results.findIndex(Boolean)];
    if (fallback)
      elements.forEach((el, i) => {
        if (!results[i]) el.style.backgroundImage = `url(sky/${fallback}.webp)`;
      });
    root.classList.toggle("sky-ready", results.some(Boolean));
  });
  return {
    setTime,
    setPaused,
    setLocation(here, date) {
      anchors = lightAnchors(here, date);
    },
    destroy() {
      cancelAnimationFrame(frame);
      reduced.removeEventListener("change", onPreference);
    },
  };
}

// The existing solar kernel supplies this date’s declination and solar noon.
// Derive the altitude crossing for sunrise and civil twilight. These are only
// colour anchors; no congregation time is calculated from the sun.
export function lightAnchors(here, date) {
  if (!here) return LIGHT_ANCHORS;
  const sun = core.solarNoonUTC(dayKey(date), here.lng);
  if (!sun) return LIGHT_ANCHORS;
  const lat = (here.lat * Math.PI) / 180;
  function crossing(altitude, after) {
    const x =
      (Math.sin((altitude * Math.PI) / 180) -
        Math.sin(lat) * Math.sin(sun.dec)) /
      (Math.cos(lat) * Math.cos(sun.dec));
    if (Math.abs(x) > 1) return null;
    const offset = ((Math.acos(x) * 180) / Math.PI / 15) * 3600000;
    return wallMinute(new Date(+sun.at + (after ? offset : -offset)));
  }
  const dawn = crossing(-6, false),
    sunrise = crossing(-0.833, false),
    sunset = crossing(-0.833, true),
    dusk = crossing(-6, true),
    noon = wallMinute(sun.at);
  if (
    [dawn, sunrise, sunset, dusk].some((x) => x == null) ||
    !(dawn < sunrise && sunrise < noon && noon < sunset && sunset < dusk)
  )
    return LIGHT_ANCHORS;
  return [
    { at: 0, sky: "isha", cloud: 0.045, stars: 0.26, spark: 0.56 },
    {
      at: Math.max(1, dawn - 45),
      sky: "isha",
      cloud: 0.05,
      stars: 0.26,
      spark: 0.56,
    },
    { at: sunrise, sky: "fajr", cloud: 0.095, stars: 0.04, spark: 0.08 },
    {
      at: Math.min(noon - 1, sunrise + 80),
      sky: "dhuhr",
      cloud: 0.16,
      stars: 0,
      spark: 0,
    },
    { at: noon, sky: "dhuhr", cloud: 0.18, stars: 0, spark: 0 },
    {
      at: noon + (sunset - noon) * 0.65,
      sky: "asr",
      cloud: 0.17,
      stars: 0,
      spark: 0,
    },
    { at: sunset, sky: "maghrib", cloud: 0.15, stars: 0.025, spark: 0.03 },
    {
      at: Math.min(1439, dusk + 35),
      sky: "isha",
      cloud: 0.045,
      stars: 0.26,
      spark: 0.56,
    },
    { at: 1440, sky: "isha", cloud: 0.045, stars: 0.26, spark: 0.56 },
  ];
}
