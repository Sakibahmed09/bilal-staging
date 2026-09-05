import {
  prayers,
  clock,
  dayWord,
  minutesLabel,
  distanceLabel,
  journeyFor,
  optionsFor,
  recommend,
  describe,
  laterNearby,
  moment,
} from "./near-model.mjs";
import { createNearSession } from "./near-session.mjs";
import { createMosqueMemory } from "./near-preference.mjs";
import { createAtmosphere } from "./near-atmosphere.mjs";
import { attachInstallUI } from "./near-install-ui.mjs";
import { attachMosqueRequest } from "./near-request-ui.mjs";
import { createOpening } from "./near-opening.mjs";
import { core, distance } from "./near-data.mjs";
import { dayKey, wallMinute, ukTime } from "./near-time.mjs";

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const ios =
  /iP(?:hone|ad|od)/.test(navigator.platform) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const nativeIOS =
  ios &&
  (navigator.standalone || matchMedia("(display-mode: standalone)").matches);
const query = new URLSearchParams(location.search),
  preview = query.get("preview") === "1";
document.documentElement.toggleAttribute("data-ios-standalone", !!nativeIOS);
function safeStorage(name) {
  try {
    return window[name];
  } catch {
    return null;
  }
}
// Screenshot fixtures have their own in-memory preferences and cannot alter
// the installed app's saved mosque or request location permission.
const mosqueMemory = createMosqueMemory(
  preview
    ? {}
    : {
        local: safeStorage("localStorage"),
        session: safeStorage("sessionStorage"),
      },
);
let previewNow = null;
const now = () => previewNow ?? Date.now();
const session = createNearSession({
  memory: mosqueMemory,
  now,
  onChange: syncState,
  ...(preview
    ? { getLocation: async () => ({ lat: 51.5257, lng: -0.072 }) }
    : {}),
});
let scenario = session.state.scenario,
  pool = [],
  custom = {},
  selected = null,
  area = "Your location",
  notice = null,
  preferenceReason = "nearby";
let opener,
  closeTimer,
  sheetCleanup = () => {},
  sheetTick = () => {},
  generation = 0,
  sheetDrag = null,
  pull = null,
  refreshing = false;
let refreshID = 0,
  refreshTimer,
  refreshOpeningTimer;
let timetableSignature = "",
  renderSignature = "",
  lockedY = 0,
  lastDay = dayKey(now()),
  lightContext = "";
const atmosphere = createAtmosphere({
  root: $("phone"),
  layers: $("skyPalette"),
  reduced,
});
const opening = createOpening({
  viewport: $("splashViewport"),
  screen: $("screen"),
  standalone: nativeIOS || matchMedia("(display-mode: standalone)").matches,
  reduced,
  preview,
  onSearch: showLocation,
});
const journey = (m) => journeyFor(m, custom);
const travelLabel = (m) =>
  journey(m) == null
    ? "Journey not set"
    : Object.hasOwn(custom, m.id)
      ? `${journey(m)} min journey`
      : `~${journey(m)} min walk`;
const usualName = () =>
  session.state.catalogue.find((m) => m.g === mosqueMemory.usual)?.n ||
  "Your saved mosque";
function announce(text) {
  $("announcement").textContent = text;
}
function syncState(state) {
  opening.update(state);
  ({ scenario, pool, custom, selected, area, notice } = state);
  preferenceReason = state.reason;
  const context = JSON.stringify([state.here, dayKey(now())]);
  if (context !== lightContext) {
    lightContext = context;
    atmosphere.setLocation(state.here, new Date(now()));
  }
  render();
}
function syncMotion() {
  const paused = document.hidden || !$("overlay").hidden;
  document.body.classList.toggle("motion-paused", paused);
  atmosphere.setPaused(paused);
}
let sheetViewportHeight = innerHeight;
function lockPage() {
  sheetViewportHeight = window.visualViewport?.height || innerHeight;
  lockedY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `${-lockedY}px`;
  document.body.style.width = "100%";
  document.documentElement.classList.add("sheet-open");
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute("content", "#252a21");
}
function unlockPage() {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.documentElement.classList.remove("sheet-open");
  document
    .querySelector("meta[name=theme-color]")
    ?.setAttribute("content", "#191b16");
  window.scrollTo({ top: lockedY, behavior: "instant" });
}
function keepFieldVisible() {
  // Standalone iOS can exclude its status area from visualViewport even with
  // no keyboard. That difference must never leave an unpainted sheet footer.
  const view = window.visualViewport;
  const focused = document.activeElement?.matches("input,textarea");
  const keyboard =
    !!view &&
    !$("overlay").hidden &&
    focused &&
    (Math.max(sheetViewportHeight, innerHeight) - view.height > 150 ||
      view.offsetTop > 100);
  const root = document.documentElement;
  root.classList.toggle("keyboard-open", keyboard);
  root.classList.toggle("ios-keyboard", keyboard && ios);
  root.style.setProperty(
    "--visible-height",
    keyboard
      ? `${view.height + (nativeIOS ? parseFloat(getComputedStyle(root).getPropertyValue("--safe-top")) || 0 : 0)}px`
      : "100dvh",
  );
  root.style.setProperty("--visible-top", `${keyboard ? view.offsetTop : 0}px`);
  const field = document.activeElement;
  if (
    !field?.matches("input,textarea") ||
    $("overlay").hidden ||
    $("overlay").classList.contains("closing")
  )
    return;
  requestAnimationFrame(() => {
    // Scroll the draft, never the document behind a fixed sheet. iOS can
    // otherwise pull the background under the status bar when focus changes.
    const content = $("sheetContent");
    if (!field.isConnected || !content.contains(field)) return;
    const box = field.getBoundingClientRect(),
      frame = content.getBoundingClientRect();
    if (box.bottom > frame.bottom)
      content.scrollTop += box.bottom - frame.bottom;
    else if (box.top < frame.top) content.scrollTop -= frame.top - box.top;
  });
}
window.visualViewport?.addEventListener("resize", keepFieldVisible);
window.visualViewport?.addEventListener("scroll", keepFieldVisible);
window.addEventListener("resize", keepFieldVisible);
keepFieldVisible();
function setDay(open) {
  $("day").setAttribute("aria-expanded", String(open));
  $("timetable").classList.toggle("open", open);
  $("timetable").inert = !open;
  $("timetable").setAttribute("aria-hidden", String(!open));
}
function usualControl(m) {
  return `<div class="usual-control">${m.id === mosqueMemory.usual ? '<div class="usual-kept"><span>Your usual mosque</span><button class="textbtn" id="forgetUsual">Forget</button></div><p class="usual-explanation">Remembered on this device.</p>' : `<button class="usual-action" id="rememberMosque"><span>Make this my usual mosque</span><span aria-hidden="true">→</span></button><p class="usual-explanation">${mosqueMemory.usual ? `Replaces ${esc(usualName())}.` : "Start here next time you’re nearby."}</p>`}<p class="preference-feedback" id="preferenceFeedback" role="status"></p></div>`;
}
function preferenceError(message) {
  const target = !$("overlay").hidden
    ? $("locationPreferenceFeedback") || $("comparisonNote")
    : $("preferenceFeedback");
  if (target) target.textContent = message;
  announce(message);
}
function rememberUsual(id) {
  if (!mosqueMemory.remember(id)) {
    preferenceError(
      "Couldn’t save on this device. Your current choice stays. Try again.",
    );
    return false;
  }
  if (selected?.mosque.id === id) mosqueMemory.choose(selected);
  landChange(() => {}, `${usualName()} is now your usual mosque.`);
  return true;
}
function forgetUsual() {
  if (!mosqueMemory.forget()) {
    preferenceError("Couldn’t remove the saved preference. Try again.");
    return false;
  }
  landChange(() => {}, "Usual mosque forgotten. Your current choice stays.");
  return true;
}
function setText(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}
function render() {
  atmosphere.setTime(wallMinute(new Date(now())));
  setText("locationLabel", area);
  $("location").setAttribute("aria-label", `Change location: ${area}`);
  $("location").title = area;
  const status = session.state.screen;
  installUI.refresh({ hasAnswer: !status && !!selected });
  $("refreshHint").classList.toggle(
    "on",
    !status && !!selected && !refreshing && !pull?.active && !opening.visible,
  );
  $("answer").hidden = !!status || !selected;
  $("statusScreen").hidden = !status;
  const notices = {
    offline: "Showing saved times · check with the mosque if unsure",
    refreshError: "Couldn’t update · showing previous times",
    locationError: "Couldn’t update your location · previous result kept",
    locationUnknown: selected?.mosque.saved
      ? "Location unavailable · showing saved times"
      : "Location unavailable · journey and distance aren’t known",
    partialNetwork: "Some nearby times couldn’t be checked",
    timesUnavailable: "Updated times aren’t available · previous result kept",
    emptyArea:
      "No published times found in the new area · previous result kept",
  };
  $("notice").hidden = !notice || !!status;
  setText("noticeText", notices[notice] || "");
  $("noticeRetry").disabled = session.state.busy;
  if (status) {
    renderStatus(status);
    return;
  }
  if (!selected) return;
  const m = selected.mosque,
    travel = journey(m),
    d = describe(selected, scenario.now, travel);
  setText("heroTitle", d.title);
  $("heroTitle").className = d.kind === "time" ? "time" : "";
  const closerStarted =
    !session.state.explicit &&
    preferenceReason === "nearby" &&
    pool.some(
      (other) =>
        (other.distance ?? Infinity) < (m.distance ?? Infinity) &&
        optionsFor(other, scenario).some(
          (o) => o.prayer === selected.prayer && o.at < scenario.now,
        ),
    );
  setText(
    "heroSub",
    [
      m.unconfirmed ? "These times aren’t confirmed by the mosque." : "",
      d.sub || (closerStarted ? `A later ${selected.prayer} nearby.` : ""),
      preferenceReason === "usual-unavailable"
        ? "Your usual’s times aren’t available. Showing a nearby jama’ah."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const prefix = m.id === mosqueMemory.usual ? "Your usual · " : "";
  const kicker =
    prefix +
    (d.kind === "time"
      ? `${d.day ? d.day[0].toUpperCase() + d.day.slice(1) + " · " : ""}${selected.prayer} jama’ah`
      : `${selected.prayer} jama’ah · ${d.day ? d.day + " " : ""}<strong>${clock(selected.at)}</strong>`);
  if ($("kicker").innerHTML !== kicker) $("kicker").innerHTML = kicker;
  setText("mosqueName", m.name);
  setText(
    "address",
    [m.address, m.distance == null ? "" : `${distanceLabel(m.distance)} away`]
      .filter(Boolean)
      .join(" · "),
  );
  setText("leave", d.journeyTitle);
  setText("edit", travel == null ? "Set minutes" : "Adjust journey");
  setText(
    "journeyDetail",
    travel == null
      ? "Walk, drive or a lift — you choose the minutes."
      : travelLabel(m) +
          (d.arrivalDifference > 0
            ? ` · ${d.arrivalDifference} min after the start`
            : ""),
  );
  $("route").href = core.mapsUrl(m.source);
  $("route").setAttribute(
    "aria-label",
    `Take me there: ${m.name} (opens maps)`,
  );
  // Do not rebuild a focused timetable or preference control on each tick.
  const signature = JSON.stringify([
    m.id,
    m.times,
    selected.key,
    mosqueMemory.usual,
    m.saved,
    m.fetchedAt,
    Object.hasOwn(custom, m.id),
    alertState.armed,
  ]);
  if (signature !== timetableSignature) {
    timetableSignature = signature;
    $("dayInner").innerHTML =
      `<table class="times"><caption>${esc(m.name)}</caption><tbody>${prayers.map((p, i) => `<tr class="${p === selected.prayer && !d.day ? "selected" : ""}"><th scope="row">${p}</th><td class="${m.times[i] == null ? "unavailable" : ""}">${m.times[i] == null ? "Not published" : clock(m.times[i])}</td></tr>`).join("")}</tbody></table><p class="detail">Jama’ah start times. End times aren’t published.${m.saved ? ` Saved ${esc(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(m.fetchedAt)))}.` : ""}${m.audit.issues.length ? " Some times are withheld for checking." : ""}</p>${usualControl(m)}${Object.hasOwn(custom, m.id) ? `<button class="usual-action" id="arm" aria-pressed="${alertState.armed}"><span>${alertState.armed ? "Leave alert is on" : "Alert me when to leave"}</span><span aria-hidden="true">${alertState.armed ? "✓" : "→"}</span></button><p class="usual-explanation" id="alertHelp">Keep Bilal open. Alert applies to this visit.</p>` : ""}<a class="report-time text-link" href="${reportUrl()}">Report a wrong time</a>`;
    if ($("rememberMosque"))
      $("rememberMosque").onclick = () => {
        if (rememberUsual(m.id))
          $("forgetUsual")?.focus({ preventScroll: true });
      };
    if ($("forgetUsual"))
      $("forgetUsual").onclick = () => {
        if (forgetUsual()) $("rememberMosque")?.focus({ preventScroll: true });
      };
    if ($("arm")) $("arm").onclick = toggleAlert;
  }
  const alternative = laterNearby(pool, selected, scenario);
  setText(
    "otherLabel",
    alternative
      ? `${alternative.prayer} ${alternative.mosque.unconfirmed ? "listed at" : "at"} ${clock(alternative.at)} nearby`
      : "Other mosques",
  );
  $("otherDetail").hidden = !alternative;
  setText("otherDetail", alternative ? "Other mosques" : "");
  $("other").classList.toggle("has-later", !!alternative);
}
function landChange(change, message) {
  const nodes = [
    $("hero"),
    document.querySelector(".destination"),
    document.querySelector(".journey"),
    $("route"),
    $("other"),
    $("day"),
  ];
  const before = nodes.map((n) => ({
    top: n.getBoundingClientRect().top,
    text: n.textContent,
  }));
  change();
  render();
  if (!reduced.matches)
    nodes.forEach((n, i) => {
      const delta = before[i].top - n.getBoundingClientRect().top;
      const changed = before[i].text !== n.textContent;
      if (Math.abs(delta) > 0.5)
        n.animate(
          [
            { transform: `translateY(${delta}px)`, opacity: changed ? 0.6 : 1 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 260, easing: "cubic-bezier(.22,.8,.25,1)" },
        );
      else if (changed)
        n.animate([{ opacity: 0.5 }, { opacity: 1 }], {
          duration: 190,
          easing: "ease-out",
        });
    });
  if (message) announce(message);
}
function sheet(title, html) {
  opening.dismiss({ immediate: true });
  sheetCleanup();
  sheetTick = () => {};
  stopHold();
  generation++;
  clearTimeout(closeTimer);
  const wasOpen = !$("overlay").hidden;
  opener = !wasOpen ? document.activeElement : opener;
  $("sheet").dataset.view = "";
  $("sheetTitle").textContent = title;
  $("sheetActions").replaceChildren();
  $("sheetActions").hidden = true;
  $("sheetContent").innerHTML = html;
  $("sheetContent").scrollTop = 0;
  $("overlay").hidden = false;
  $("overlay").className = "overlay";
  $("overlay").style.cssText = "";
  $("sheet").style.transform = "";
  $("sheet").inert = false;

  $("screen").inert = true;
  if (!wasOpen) lockPage();
  keepFieldVisible();
  const current = generation;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (current === generation && !$("overlay").hidden) {
        $("overlay").classList.add("open");
        $("close").focus({ preventScroll: true });
      }
    }),
  );
  syncMotion();
}
function close(after) {
  if ($("overlay").hidden || $("overlay").classList.contains("closing")) return;
  generation++;
  sheetCleanup();
  sheetCleanup = () => {};
  sheetTick = () => {};
  stopHold();
  sheetDrag = null;
  // Hold the closing frame while the native keyboard retracts.
  const frame = $("overlay").getBoundingClientRect();
  $("overlay").style.height = `${frame.height}px`;
  $("overlay").style.top = `${frame.top}px`;
  if (document.activeElement?.matches("input,textarea"))
    document.activeElement.blur();
  $("overlay").classList.remove("open", "sheet-drag");
  $("overlay").style.background = "";
  $("sheet").style.transform = "";
  $("sheet").inert = true;
  $("overlay").classList.add("closing");
  closeTimer = setTimeout(
    () => {
      $("overlay").hidden = true;
      $("overlay").className = "overlay";
      $("overlay").style.cssText = "";
      $("sheet").inert = false;
      $("screen").inert = false;
      unlockPage();
      if (typeof after === "function") after();
      if (opener?.isConnected && !opener.closest("[hidden]"))
        opener.focus({ preventScroll: true });
      syncMotion();
    },
    reduced.matches ? 0 : $("sheet").dataset.view === "mosques" ? 300 : 170,
  );
}
$("close").onclick = () => close();
$("overlay").onclick = (e) => {
  if (e.target === $("overlay")) close();
};
document.addEventListener("keydown", (e) => {
  if ($("overlay").hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return;
  }
  if (e.key === "Tab") {
    const els = [
      ...$("sheet").querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        !el.closest("[hidden],[inert]") &&
        el.getClientRects().length,
    );
    const first = els[0],
      last = els.at(-1);
    if (!first) {
      e.preventDefault();
      $("sheet").focus();
      return;
    }
    if (
      e.shiftKey &&
      (document.activeElement === first ||
        !els.includes(document.activeElement))
    ) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (document.activeElement === last || !els.includes(document.activeElement))
    ) {
      e.preventDefault();
      first.focus();
    }
  }
});
$("day").onclick = () =>
  setDay($("day").getAttribute("aria-expanded") !== "true");

function searchField(id, label, placeholder) {
  return `<div class="search-field">${icon("search")}<input id="${id}" type="search" aria-label="${label}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"><button id="${id}Clear" type="button" aria-label="Clear search" hidden>${icon("x")}</button></div>`;
}
function wireClear(id, onInput) {
  const field = $(id),
    clear = $(`${id}Clear`);
  field.oninput = () => {
    clear.hidden = !field.value;
    onInput();
  };
  clear.onclick = () => {
    field.value = "";
    clear.hidden = true;
    onInput();
    field.focus();
  };
}

let holdDelay, holdRepeat;
function stopHold() {
  clearTimeout(holdDelay);
  clearInterval(holdRepeat);
}
function showJourney() {
  const editing = selected,
    from = JSON.stringify(session.state.here);
  const original = journey(editing.mosque),
    initial = original ?? editing.mosque.walk ?? 5;
  sheet(
    "Your journey",
    `<p>How long will it take you to get there?</p><form id="journeyForm" novalidate><div class="minute-control"><button class="minute-step" id="less" type="button" aria-label="One minute less">−</button><div class="minute-value"><input id="walk" aria-label="Journey in minutes" aria-describedby="minuteHint" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="120" step="1" required value="${initial}"><span class="minute-unit" id="minuteUnit">minutes</span></div><button class="minute-step" id="more" type="button" aria-label="One minute more">+</button></div><div class="minute-ruler" id="minuteRuler" role="slider" tabindex="0" aria-label="Journey duration" aria-valuemin="1" aria-valuemax="120"><div class="ruler-track" id="rulerTrack" aria-hidden="true"></div><span class="ruler-index" aria-hidden="true"></span></div><p class="entry-hint" id="minuteHint">Drag to adjust · tap the number to type</p><div class="journey-preview" role="status" aria-atomic="true"><strong id="arrivalPreview"></strong><p id="arrivalContext"></p></div><button class="solid" id="useJourney" type="submit"></button>${Object.hasOwn(custom, editing.mosque.id) && editing.mosque.walk != null ? `<button class="reset-journey" id="resetJourney" type="button">Use the ${editing.mosque.walk} min walking estimate</button>` : ""}</form>`,
  );
  $("sheet").dataset.view = "journey";
  // Keep the commit action outside the scrolling draft, including above the
  // native keyboard. A long draft or small screen must not bury the button.
  $("useJourney").setAttribute("form", "journeyForm");
  $("sheetActions").append($("useJourney"));
  if ($("resetJourney")) $("sheetActions").append($("resetJourney"));
  $("sheetActions").hidden = false;
  const input = $("walk"),
    ruler = $("minuteRuler");
  let drag = null,
    lastValid = initial,
    changeAnimation;
  const position = (v, fraction = 0) =>
    ($("rulerTrack").style.transform =
      `translateX(${-(v - 1) * 20 + fraction}px)`);
  $("rulerTrack").innerHTML = Array.from(
    { length: 120 },
    (_, i) =>
      `<span class="ruler-tick ${(i + 1) % 5 === 0 ? "major" : ""}" style="left:${i * 20}px">${(i + 1) % 5 === 0 ? `<small>${i + 1}</small>` : ""}</span>`,
  ).join("");
  function update() {
    const v = Number(input.value),
      valid = input.value !== "" && Number.isInteger(v) && v >= 1 && v <= 120;
    input.setAttribute("aria-invalid", String(!valid));
    $("useJourney").disabled = !valid;
    $("less").disabled = valid && v === 1;
    $("more").disabled = valid && v === 120;
    if (!valid) {
      $("arrivalPreview").textContent = "Choose 1–120 whole minutes";
      $("arrivalContext").textContent = "Type a number, or use the ruler.";
      $("useJourney").textContent = "Set journey";
      return;
    }
    lastValid = v;
    position(v);
    ruler.setAttribute("aria-valuenow", v);
    ruler.setAttribute("aria-valuetext", minutesLabel(v));
    const arrival = scenario.now + v,
      diff = Math.ceil(arrival - editing.at);
    const future = editing.at - scenario.now >= 60;
    $("arrivalPreview").textContent = future
      ? `Leave ${dayWord(editing.at - v, scenario.now) ? dayWord(editing.at - v, scenario.now) + " " : ""}by ${clock(editing.at - v)}`
      : `Arrive around ${clock(arrival)}`;
    $("arrivalContext").textContent =
      future || Math.abs(diff) >= 60
        ? `${editing.prayer} ${editing.at < scenario.now ? "started" : "starts"} ${dayWord(editing.at, scenario.now) ? dayWord(editing.at, scenario.now) + " " : ""}at ${clock(editing.at)}`
        : diff === 0
          ? `${editing.prayer} starts at ${clock(editing.at)}`
          : `${Math.abs(diff)} min ${diff > 0 ? "after" : "before"} the ${clock(editing.at)} start`;
    $("minuteUnit").textContent = v === 1 ? "minute" : "minutes";
    $("useJourney").textContent = `Use ${minutesLabel(v)}`;
  }
  function step(d) {
    const previous = lastValid,
      next = Math.max(1, Math.min(120, previous + d));
    input.value = next;
    update();
    if (next !== previous && !reduced.matches) {
      changeAnimation?.cancel();
      changeAnimation = input.animate(
        [
          { transform: `translateY(${-Math.sign(d) * 3}px)`, opacity: 0.65 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 130, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
    }
  }
  for (const [id, d] of [
    ["less", -1],
    ["more", 1],
  ]) {
    const btn = $(id);
    btn.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.focus();
      btn.setPointerCapture(e.pointerId);
      step(d);
      stopHold();
      holdDelay = setTimeout(() => {
        holdRepeat = setInterval(() => step(d), 100);
      }, 420);
    };
    btn.onpointerup = stopHold;
    btn.onpointercancel = stopHold;
    btn.onlostpointercapture = stopHold;
    btn.onclick = (e) => {
      if (e.detail === 0) step(d);
    };
  }
  ruler.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopHold();
    ruler.focus();
    ruler.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, value: lastValid };
    ruler.classList.add("dragging");
  };
  ruler.onpointermove = (e) => {
    if (!drag) return;
    const raw = drag.value + (drag.x - e.clientX) / 20,
      next = Math.max(1, Math.min(120, Math.round(raw)));
    input.value = next;
    update();
    position(next, raw <= 1 || raw >= 120 ? 0 : (next - raw) * 20);
  };
  function endDrag() {
    drag = null;
    ruler.classList.remove("dragging");
    position(lastValid);
  }
  ruler.onpointerup = endDrag;
  ruler.onpointercancel = endDrag;
  ruler.onlostpointercapture = endDrag;
  ruler.onkeydown = (e) => {
    const delta = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 5,
      PageDown: -5,
    }[e.key];
    if (delta) {
      e.preventDefault();
      step(delta);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      input.value = e.key === "Home" ? 1 : 120;
      update();
    }
  };
  input.onfocus = () => {
    input.select();
    keepFieldVisible();
  };
  input.oninput = update;
  input.onkeydown = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      step(e.key === "ArrowUp" ? 1 : -1);
    }
  };
  $("journeyForm").onsubmit = (e) => {
    e.preventDefault();
    update();
    if ($("useJourney").disabled) {
      input.focus();
      return;
    }
    const value = Number(input.value);
    if (
      selected?.mosque.id !== editing.mosque.id ||
      JSON.stringify(session.state.here) !== from
    ) {
      close(() =>
        announce(
          "The result changed. Adjust the journey for your current mosque.",
        ),
      );
      return;
    }
    close(() =>
      landChange(
        () => {
          session.selectJourney(value);
          disarmAlert();
        },
        `Journey set to ${minutesLabel(value)}.`,
      ),
    );
  };
  if ($("resetJourney"))
    $("resetJourney").onclick = () => {
      if (selected?.mosque.id === editing.mosque.id)
        close(() =>
          landChange(() => {
            session.selectJourney(null);
            disarmAlert();
          }, "Walking estimate restored."),
        );
      else close();
    };
  sheetCleanup = () => {
    stopHold();
    changeAnimation?.cancel();
  };
  sheetTick = () => {
    if (!drag) update();
  };
  update();
}
$("edit").onclick = showJourney;

$("sheetHead").addEventListener("pointerdown", (e) => {
  if (
    e.button !== 0 ||
    e.target.closest("button") ||
    $("overlay").classList.contains("closing")
  )
    return;
  e.preventDefault();
  $("sheetHead").setPointerCapture(e.pointerId);
  sheetDrag = {
    start: e.clientY,
    distance: 0,
    last: e.clientY,
    time: performance.now(),
    velocity: 0,
  };
  $("overlay").classList.add("sheet-drag");
});
$("sheetHead").addEventListener("pointermove", (e) => {
  if (!sheetDrag) return;
  const t = performance.now(),
    elapsed = Math.max(1, t - sheetDrag.time);
  sheetDrag.velocity = (e.clientY - sheetDrag.last) / elapsed;
  sheetDrag.last = e.clientY;
  sheetDrag.time = t;
  const dy = e.clientY - sheetDrag.start;
  sheetDrag.distance = Math.max(0, dy);
  $("sheet").style.transform =
    `translateY(${dy >= 0 ? dy * 0.85 : dy * 0.12}px)`;
  $("overlay").style.background =
    `rgba(10,14,9,${Math.max(0.12, 0.6 - sheetDrag.distance / 700)})`;
});
function releaseSheet(cancel = false) {
  if (!sheetDrag) return;
  const velocity =
    performance.now() - sheetDrag.time > 100 ? 0 : sheetDrag.velocity;
  const dismiss =
    !cancel &&
    (sheetDrag.distance > 86 || (sheetDrag.distance > 30 && velocity > 0.55));
  if (dismiss)
    $("overlay").style.setProperty(
      "--sheet-exit",
      `${sheetDrag.distance * 0.85 + 24}px`,
    );
  sheetDrag = null;
  $("overlay").classList.remove("sheet-drag");
  if (dismiss) close();
  else {
    $("sheet").style.transform = "";
    $("overlay").style.background = "";
  }
}
$("sheetHead").addEventListener("pointerup", () => releaseSheet());
$("sheetHead").addEventListener("pointercancel", () => releaseSheet(true));
$("sheetHead").addEventListener("lostpointercapture", () => releaseSheet(true));

const mosqueRequests = attachMosqueRequest({
  sheet,
  close,
  esc,
  preview,
  storage: preview ? null : safeStorage("sessionStorage"),
  actions(html) {
    $("sheetActions").innerHTML = html;
    $("sheetActions").hidden = false;
  },
  setCleanup(fn) {
    sheetCleanup = fn;
  },
});

function showOthers() {
  sheet(
    "Jama’ahs nearby",
    `${searchField("mosqueSearch", "Search mosques", "Mosque name")}<div id="mosqueResults"></div><p class="detail" id="comparisonNote">Times shown are starts. A jama’ah may continue after its start.</p><div class="request-entry" id="requestEntry"><button class="text-link" id="addMissingMosque"><span>Can’t find your mosque?</span><span aria-hidden="true">→</span></button><p>Send their website. Help bring your local jama’ah to Bilal.</p></div><div class="sr-only" role="status" id="searchCount"></div>`,
  );
  $("sheet").dataset.view = "mosques";
  const view = generation;
  function draw() {
    const query = $("mosqueSearch").value.trim().toLocaleLowerCase();
    const all = pool.flatMap((m) => optionsFor(m, scenario));
    const matches = (m) =>
      `${m.name} ${m.address}`.toLocaleLowerCase().includes(query);
    const rows = all.filter((o) => matches(o.mosque));
    const groups = [
      ["Before the start", []],
      ["Arrive after the start", []],
      ["Recently started", []],
      ["Next jama’ah", []],
      ["Earlier starts", []],
    ];
    for (const o of rows) {
      const travel = journey(o.mosque),
        current =
          o.prayer === scenario.prayer && o.date === scenario.prayerDate;
      const group = !current
        ? 3
        : o.at < scenario.now
          ? scenario.now - o.at < 15
            ? 2
            : 4
          : travel != null && scenario.now + travel > o.at
            ? 1
            : 0;
      groups[group][1].push(o);
    }
    const ordered = (
      selected?.prayer === scenario.prayer ||
      (selected && laterNearby(pool, selected, scenario))
        ? [0, 1, 2, 4, 3]
        : [3, 0, 1, 2, 4]
    ).map((i) => groups[i]);
    let html = ordered
      .filter(([, items]) => items.length)
      .map(
        ([label, items]) =>
          `<h3 class="group-title">${label}</h3>${items
            .sort(
              (a, b) =>
                (a.mosque.distance ?? Infinity) -
                (b.mosque.distance ?? Infinity),
            )
            .map((o) => {
              const d = describe(o, scenario.now, journey(o.mosque)),
                isSelected = o.key === selected?.key;
              const timing =
                o.at < scenario.now
                  ? scenario.now - o.at < 1
                    ? "Started just now"
                    : `Started ${Math.floor(scenario.now - o.at)} min ago`
                  : d.until === 0
                    ? "Starts now"
                    : d.day
                      ? `${d.day[0].toUpperCase() + d.day.slice(1)}`
                      : d.leaveIn == null
                        ? "Set your journey"
                        : d.leaveIn < 0
                          ? `Arrive around ${clock(d.arrival)} · ${d.arrivalDifference} min after start`
                          : d.leaveIn === 0
                            ? "Leave now"
                            : d.leaveIn >= 60
                              ? `Leave by ${clock(o.at - journey(o.mosque))}`
                              : `Leave in ${d.leaveIn} min`;
              return `<button class="choice" data-choice="${esc(o.key)}" aria-pressed="${isSelected}"><span class="choice-title"><strong>${esc(o.mosque.name)}</strong><span class="choice-time"><em>${o.prayer}</em><b>${clock(o.at)}</b></span></span><small>${o.mosque.distance == null ? "" : distanceLabel(o.mosque.distance) + " away · "}${travelLabel(o.mosque)}${isSelected ? " · Selected" : ""}${o.mosque.id === mosqueMemory.usual ? " · Your usual" : ""}${o.mosque.saved ? " · Saved times" : ""}${o.mosque.unconfirmed ? " · Times unconfirmed" : ""}</small><small class="availability">${timing}</small></button>${isSelected && o.mosque.id !== mosqueMemory.usual ? `<button class="usual-action choice-remember" data-remember="${esc(o.mosque.id)}"><span>Make this my usual mosque</span><span aria-hidden="true">→</span></button>` : ""}`;
            })
            .join("")}`,
      )
      .join("");
    const missing = pool.filter(
      (m) => !optionsFor(m, scenario).length && matches(m),
    );
    if (missing.length)
      html +=
        `<h3 class="group-title">Times unavailable</h3>` +
        missing
          .map(
            (m) =>
              `<div class="unavailable-mosque"><strong>${esc(m.name)}</strong><p>${esc(m.verdict.why)}.</p><a class="text-link" href="${core.mapsUrl(m.source)}" target="_blank" rel="noopener">Find this mosque on Maps</a></div>`,
          )
          .join("");
    // Searching still reaches the real directory. Unchecked names never acquire
    // a made-up prayer time; one deliberate tap fetches their timetable.
    const known = new Set(pool.map((m) => m.id));
    let extra = [];
    if (query.length >= 2)
      extra = session.state.catalogue
        .filter(
          (m) =>
            !known.has(m.g) &&
            `${m.n} ${m.a || ""}`.toLocaleLowerCase().includes(query),
        )
        .sort((a, b) => {
          const aName = a.n.toLowerCase().startsWith(query)
              ? 0
              : a.n.toLowerCase().includes(query)
                ? 1
                : 2,
            bName = b.n.toLowerCase().startsWith(query)
              ? 0
              : b.n.toLowerCase().includes(query)
                ? 1
                : 2;
          return (
            aName - bName ||
            (session.state.here
              ? distance(session.state.here, a) -
                distance(session.state.here, b)
              : a.n.localeCompare(b.n))
          );
        })
        .slice(0, 6);
    else
      extra = session.state.unavailable.filter((r) => r.error).map((r) => r.m);
    if (extra.length)
      html +=
        `<h3 class="group-title">${query.length >= 2 ? "More matches in the directory" : "Couldn’t check these times"}</h3>` +
        extra
          .map(
            (m) =>
              `<button class="place-choice" data-check="${esc(m.g)}">${esc(m.n)}<small>${esc(m.a || "")} · Tap to check times</small></button>`,
          )
          .join("");
    const noMatches = !html;
    if (noMatches)
      html =
        '<div class="empty-result request-empty"><strong>Let’s bring your mosque to Bilal.</strong><p>We haven’t found it in the directory. Send their website and we’ll take it from here.</p><button class="solid" id="addSearchMosque">Add your mosque</button><button class="text-link" id="changeSearchArea">Try another area</button></div>';
    $("comparisonNote").hidden = noMatches;
    $("requestEntry").hidden = noMatches;
    $("mosqueResults").innerHTML = html;
    $("searchCount").textContent =
      `${new Set(rows.map((o) => o.mosque.id)).size} mosques with times`;
    $("changeSearchArea")?.addEventListener("click", showLocation);
    const add = () => mosqueRequests.show($("mosqueSearch").value.trim());
    $("addSearchMosque")?.addEventListener("click", add);
    $("addMissingMosque").onclick = add;
    $("mosqueResults")
      .querySelectorAll("[data-choice]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const next = all.find((o) => o.key === b.dataset.choice);
            b.classList.add("chosen");
            close(() =>
              landChange(
                () => {
                  disarmAlert();
                  session.choose(next);
                },
                `${next.mosque.name}. ${next.prayer} at ${clock(next.at)}.`,
              ),
            );
          }),
      );
    $("mosqueResults")
      .querySelectorAll("[data-remember]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            if (rememberUsual(b.dataset.remember)) {
              draw();
              $("mosqueSearch").focus({ preventScroll: true });
            }
          }),
      );
    $("mosqueResults")
      .querySelectorAll("[data-check]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            b.querySelector("small").textContent = "Checking their times…";
            try {
              await session.checkMosque(
                extra.find((m) => m.g === b.dataset.check),
              );
              if (view === generation) draw();
            } catch {
              if (view === generation && b.isConnected) {
                b.disabled = false;
                b.querySelector("small").textContent =
                  "Times couldn’t load · tap to retry";
              }
            }
          }),
      );
  }
  wireClear("mosqueSearch", draw);
  draw();
  let lastMinute = Math.floor(scenario.now);
  sheetTick = () => {
    if (Math.floor(scenario.now) === lastMinute) return;
    lastMinute = Math.floor(scenario.now);
    const active = document.activeElement?.dataset.choice,
      top = $("sheetContent").scrollTop;
    draw();
    if (active)
      $("mosqueResults")
        .querySelector(`[data-choice="${CSS.escape(active)}"]`)
        ?.focus({ preventScroll: true });
    $("sheetContent").scrollTop = top;
  };
}
$("other").onclick = showOthers;
function showLocation() {
  if (refreshing) {
    session.cancel();
    resetRefresh();
  }
  if (session.state.busy && !selected) {
    session.cancel();
    session.state.screen = "location";
    syncState(session.state);
  }
  sheet(
    "Your location",
    `${session.state.here ? `<p>${area === "Where you are now" ? "Using your current location." : `Currently near ${esc(area)}.`}</p>` : "<p>Search any UK address, place or postcode.</p>"}<form id="placeForm" novalidate><label class="sr-only" for="placeQuery">Address, place or postcode</label>${searchField("placeQuery", "Address, place or postcode", "E1 6QL or Brick Lane")}<p class="field-error" id="placeError" role="status"></p><button class="solid" id="placeGo">Find nearby jama’ahs</button></form><div id="placeResults"></div><button class="text-link" id="refreshLocation">Use my current location</button>${mosqueMemory.usual ? `<section class="usual-location"><p>Your usual mosque</p><div class="usual-location-name">${esc(usualName())}</div><p>Remembered on this device.</p><button class="text-link" id="locationForgetUsual">Forget this preference</button><p class="preference-feedback" id="locationPreferenceFeedback" role="status"></p></section>` : ""}<p class="detail place-credit">No address history is kept. Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>`,
  );
  if ($("locationForgetUsual"))
    $("locationForgetUsual").onclick = () => {
      if (forgetUsual()) {
        $("locationForgetUsual").closest(".usual-location").remove();
        $("refreshLocation").focus({ preventScroll: true });
      }
    };
  const view = generation;
  let searchController = null,
    request = 0;
  wireClear("placeQuery", () => {
    request++;
    searchController?.abort();
    $("placeGo").hidden = false;
    $("placeGo").disabled = false;
    $("placeGo").textContent = "Find nearby jama’ahs";
    $("placeError").textContent = "";
    $("placeQuery").removeAttribute("aria-invalid");
    $("placeResults").innerHTML = "";
  });
  $("placeQuery").addEventListener("focus", keepFieldVisible);
  $("placeForm").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("placeQuery").value.trim();
    if (text.length < 2) {
      $("placeError").textContent = "Enter a postcode or at least two letters.";
      $("placeQuery").setAttribute("aria-invalid", "true");
      $("placeQuery").focus();
      return;
    }
    searchController?.abort();
    searchController = new AbortController();
    const thisRequest = ++request;
    $("placeError").textContent = "";
    $("placeGo").disabled = true;
    $("placeGo").textContent = "Finding the area…";
    $("placeResults").innerHTML = "";
    try {
      const places = await session.data.geocode(text, {
        signal: searchController.signal,
      });
      if (view !== generation || thisRequest !== request) return;
      $("placeGo").disabled = false;
      $("placeGo").textContent = "Find nearby jama’ahs";
      if (!places.length) {
        $("placeError").textContent =
          "No matching area. Try a postcode or add the town.";
        return;
      }
      const use = (p) =>
        close(() => {
          disarmAlert();
          session.start({ place: p });
        });
      if (places.length === 1) {
        use(places[0]);
        return;
      }
      $("placeGo").hidden = true;
      $("placeResults").innerHTML =
        '<p class="detail">Which place did you mean?</p>' +
        places
          .map(
            (p, i) =>
              `<button class="place-choice" data-place="${i}">${esc(p.label || text)}<small>${esc(p.detail || "")}</small></button>`,
          )
          .join("");
      $("placeResults")
        .querySelectorAll("[data-place]")
        .forEach(
          (b) => (b.onclick = () => use(places[Number(b.dataset.place)])),
        );
      $("placeResults").querySelector("button")?.focus();
    } catch {
      if (view !== generation || thisRequest !== request) return;
      $("placeGo").disabled = false;
      $("placeGo").textContent = "Find nearby jama’ahs";
      $("placeError").textContent =
        "The area couldn’t be checked. Check your connection and try again.";
    }
  };
  $("refreshLocation").onclick = () => close(() => refreshLocation());
  sheetCleanup = () => {
    request++;
    searchController?.abort();
  };
}
$("location").onclick = showLocation;
$("about").onclick = () => {
  sheet(
    "Bilal",
    `<p class="mission">Bringing us together in the masjid, one jama’ah at a time.</p><a class="mission-link" href="https://bilalathan.co.uk/" target="_blank" rel="noopener" aria-label="Discover Bilal (opens a new tab)">Discover Bilal${icon("arrow")}</a>${installUI.installed() ? "" : '<button class="text-link about-install" id="aboutInstall">Add Bilal to Home Screen →</button>'}<details class="privacy-detail"><summary>Your privacy and these times</summary><p>Your location is used to find nearby mosques. Bilal keeps no location or address history on this device. A usual mosque is saved only when you ask. Public timetables are kept for offline access.</p><p>Times come from the mosque listings available to Bilal. A congregation may continue after its published start; its end time isn’t known. Walking times are estimates, not live routes.</p><p>If you request a mosque, Bilal receives its name and website. An email is optional and is used to update you about that request. Your draft is kept in this browser tab; your email isn’t stored on this device.</p><a class="text-link" href="${selected ? reportUrl() : "bug.html?from=near"}">Report a problem</a></details>`,
  );
  $("aboutInstall")?.addEventListener("click", () => installUI.show());
};
function renderStatus(status) {
  const states = {
    locate: [
      "Finding where you are",
      "A nearby jama’ah starts with your location.",
      "Search an area instead",
    ],
    loading: [
      "Checking jama’ahs nearby",
      "Finding the published prayer times around you.",
      "Search another area",
    ],
    permission: [
      "Where shall we look?",
      "Location access is off. Search a postcode or area to find jama’ahs nearby.",
      "Search a postcode or area",
    ],
    location: [
      "Where shall we look?",
      "Search a UK address, place or postcode, or try your location again.",
      "Search a postcode or area",
    ],
    empty: [
      "No times nearby yet",
      "Your local mosque could help someone else find their jama’ah too. Send us its website and we’ll check its prayer times.",
      "Add your mosque",
    ],
    failure: [
      "Times couldn’t load",
      "Check your connection and try again. There are no current saved times to show.",
      "Try again",
    ],
  };
  const [title, body, action] = states[status] || states.failure;
  const signature = [status, title, body, action].join("|");
  if (signature === renderSignature) return;
  renderSignature = signature;
  $("statusScreen").innerHTML =
    `<h2>${title}</h2><p>${body}</p>${["locate", "loading"].includes(status) ? '<div class="loading-rule" aria-hidden="true"></div>' : ""}<button class="${["locate", "loading"].includes(status) ? "text-link" : "solid"}" id="statusAction">${action}</button>${status === "location" ? '<button class="text-link" id="statusRetry">Try my location again</button>' : ""}${["empty", "failure"].includes(status) ? '<button class="text-link" id="statusSearch">Search another area</button>' : ""}${["empty", "failure"].includes(status) && (pool.length || session.state.unavailable.length) ? '<button class="text-link" id="statusMosques">See the mosques in this area</button>' : ""}`;
  $("statusAction").onclick =
    status === "failure"
      ? () => session.start({ refresh: true })
      : status === "empty"
        ? () => mosqueRequests.show()
        : showLocation;
  if ($("statusRetry"))
    $("statusRetry").onclick = () => session.start({ refresh: true });
  if ($("statusMosques")) $("statusMosques").onclick = showOthers;
  if ($("statusSearch")) $("statusSearch").onclick = showLocation;
}
function reportUrl() {
  const o = selected;
  return (
    "bug.html?" +
    new URLSearchParams({
      from: "near",
      kind: "times",
      mosque: o.mosque.id,
      name: o.mosque.name,
      date: o.date,
      prayer: o.prayer,
      time: clock(o.at),
    })
  );
}
const alertState = { armed: false, token: 0, target: null };
function disarmAlert() {
  alertState.token++;
  alertState.armed = false;
  alertState.target = null;
  $("athan").pause();
}
async function toggleAlert() {
  if (alertState.armed) {
    disarmAlert();
    render();
    $("arm")?.focus({ preventScroll: true });
    return;
  }
  const leaveAt = selected.at - journey(selected.mosque);
  if (leaveAt <= scenario.now) {
    $("alertHelp").textContent =
      "The departure time has passed. You can still head over.";
    return;
  }
  const token = ++alertState.token,
    target = {
      key: selected.key,
      mosque: selected.mosque.id,
      leaveAt,
      start: selected.at,
    };
  const audio = $("athan");
  audio.volume = 0;
  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;
    if (token !== alertState.token) return;
    alertState.armed = true;
    alertState.target = target;
    render();
    $("arm")?.focus({ preventScroll: true });
  } catch {
    if (token === alertState.token && $("alertHelp"))
      $("alertHelp").textContent = "The alert couldn’t start. Try again.";
  }
}
function checkAlert() {
  const target = alertState.target;
  if (!alertState.armed || !target) return;
  if (
    selected?.key !== target.key ||
    selected?.mosque.id !== target.mosque ||
    scenario.now >= target.start
  ) {
    disarmAlert();
    return;
  }
  if (scenario.now < target.leaveAt) return;
  disarmAlert();
  $("athan").volume = 1;
  $("athan")
    .play()
    .catch(() => announce("Time to leave. Your audio could not play."));
  announce(
    `Time to leave for ${selected.mosque.name}. ${selected.prayer} at ${clock(selected.at)}.`,
  );
  document.body.classList.add("calling");
  setTimeout(() => document.body.classList.remove("calling"), 1500);
  // Only an already granted permission is used. No prompt interrupts the
  // journey editor or promises an alarm after the installed app closes.
  if (
    globalThis.Notification?.permission === "granted" &&
    navigator.serviceWorker
  ) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.showNotification(`Leave for ${selected.mosque.name}`, {
          body: `${selected.prayer} jama’ah at ${clock(selected.at)}`,
          icon: "/icon-192.png",
          tag: "bilal-near-leave",
          data: { url: "/near" },
        }),
      )
      .catch(() => {});
  }
  render();
}

function syncIpadWindowing() {
  const tablet = nativeIOS && Math.min(screen.width, screen.height) >= 700;
  const windowed =
    tablet &&
    (Math.min(innerWidth, innerHeight) <
      Math.min(screen.width, screen.height) - 2 ||
      Math.max(innerWidth, innerHeight) <
        Math.max(screen.width, screen.height) - 2);
  document.documentElement.toggleAttribute("data-ipad-windowed", windowed);
}
syncIpadWindowing();
window.addEventListener("resize", syncIpadWindowing);
function resetRefresh() {
  refreshID++;
  clearTimeout(refreshTimer);
  clearTimeout(refreshOpeningTimer);
  refreshing = false;
  $("phone").classList.remove("pulling");
  $("screen").style.transform = "";
  $("refreshStatus").className = "refresh-status";
  $("refreshText").textContent = "";
  $("refreshStatus").style.transform = "";
  $("refreshStatus").querySelector(".icon").style.transform = "";
  $("refreshHint").classList.toggle(
    "on",
    !!selected && !session.state.screen && !opening.visible,
  );
}
async function refreshLocation({ openingBeat = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  const id = ++refreshID;
  disarmAlert();
  $("refreshStatus").className = "refresh-status visible busy";
  $("refreshText").textContent = "Finding you again";
  $("refreshStatus").style.transform = "translateY(0)";
  $("refreshStatus").querySelector(".icon").style.transform = "";
  $("refreshHint").classList.remove("on");
  if (!nativeIOS && !reduced.matches)
    $("screen").style.transform = "translateY(52px)";
  if (openingBeat && !preview) {
    refreshOpeningTimer = setTimeout(() => {
      if (id !== refreshID || !session.state.busy) return;
      opening.show("finding where you are");
      opening.update(session.state);
    }, 240);
  }
  await session.start({ refresh: true });
  clearTimeout(refreshOpeningTimer);
  if (id !== refreshID) return;
  $("refreshStatus").className = "refresh-status visible finished";
  $("refreshText").textContent =
    session.state.notice === "locationError"
      ? "Couldn’t update location"
      : session.state.notice === "refreshError"
        ? "Couldn’t update times"
        : session.state.screen
          ? "Update couldn’t finish"
          : "Location and times updated";
  refreshTimer = setTimeout(() => {
    if (id === refreshID) resetRefresh();
  }, 1000);
}
$("noticeRetry").onclick = refreshLocation;
function pullStart(x, y, target) {
  if (
    refreshing ||
    opening.visible ||
    !$("overlay").hidden ||
    window.scrollY > 0 ||
    target.closest("button,a,input,[role=slider]")
  )
    return;
  if (y < 0) return;
  pull = { x, y, distance: 0, active: false, ready: false };
}
function pullMove(x, y, event) {
  if (!pull) return;
  const dy = y - pull.y,
    dx = x - pull.x;
  if (!pull.active && (Math.abs(dx) > 12 || dy < -6)) {
    pull = null;
    return;
  }
  if (dy <= 8 && !pull.active) return;
  if (!nativeIOS && event.cancelable) event.preventDefault();
  pull.active = true;
  $("phone").classList.add("pulling");
  pull.distance = core.pullDistance(dy, dx, true, 0.44, 108);
  $("refreshHint").classList.remove("on");
  if (!nativeIOS && !reduced.matches)
    $("screen").style.transform = `translateY(${pull.distance}px)`;
  $("refreshStatus").className =
    `refresh-status visible${pull.distance >= 72 ? " ready" : ""}`;
  $("refreshText").textContent =
    pull.distance >= 72 ? "Release to refresh" : "Pull to refresh";
  $("refreshStatus").style.transform = reduced.matches
    ? "none"
    : `translateY(${-54 + pull.distance}px)`;
  $("refreshStatus").querySelector(".icon").style.transform =
    `rotate(${Math.min(180, (pull.distance / 72) * 180)}deg)`;
  const ready = pull.distance >= 72;
  if (ready && !pull.ready && !reduced.matches) {
    try {
      navigator.vibrate?.(8);
    } catch {}
  }
  pull.ready = ready;
}
function pullEnd(cancel = false) {
  if (!pull) return;
  const ready = !cancel && pull.active && pull.distance >= 72;
  pull = null;
  $("phone").classList.remove("pulling");
  if (ready) refreshLocation({ openingBeat: true });
  else if (!refreshing) resetRefresh();
}
$("phone").addEventListener(
  "touchstart",
  (e) => {
    if (ios && !nativeIOS) return;
    if (e.touches.length === 1)
      pullStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
    else pullEnd(true);
  },
  { passive: true },
);
$("phone").addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length === 1)
      pullMove(e.touches[0].clientX, e.touches[0].clientY, e);
  },
  { passive: false },
);
$("phone").addEventListener("touchend", () => pullEnd());
$("phone").addEventListener("touchcancel", () => pullEnd(true));
$("phone").addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button === 0) {
    pullStart(e.clientX, e.clientY, e.target);
    if (pull) {
      e.preventDefault();
      $("phone").setPointerCapture(e.pointerId);
    }
  }
});
$("phone").addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") pullMove(e.clientX, e.clientY, e);
});
$("phone").addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse") pullEnd();
});
// Native touch scrolling cancels its compatibility pointer stream. The touch
// stream still owns the gesture until touchend; only mouse cancellation may
// cancel the mouse fallback. Otherwise installed iOS loses refresh mid-pull.
$("phone").addEventListener("pointercancel", (e) => {
  if (e.pointerType === "mouse") pullEnd(true);
});
$("phone").addEventListener("lostpointercapture", (e) => {
  if (e.pointerType === "mouse") pullEnd(true);
});
const installUI = attachInstallUI({
  sheet,
  close,
  setCleanup: (fn) => {
    sheetCleanup = fn;
  },
  announce,
  reduced,
});
$("initialSearch")?.addEventListener("click", showLocation);
setInterval(() => {
  if (document.hidden) return;
  session.tick();
  syncState(session.state);
  sheetTick();
  checkAlert();
  if (dayKey(now()) !== lastDay) {
    lastDay = dayKey(now());
    if (!preview)
      session.start({
        place: session.state.here
          ? { ...session.state.here, label: area }
          : null,
        refresh: true,
      });
  }
}, 1000);
document.addEventListener("visibilitychange", () => {
  syncMotion();
  stopHold();
  if (document.hidden) {
    pullEnd(true);
    releaseSheet(true);
  } else {
    session.tick();
    syncState(session.state);
    sheetTick();
    checkAlert();
  }
});
window.addEventListener("online", () => {
  if (session.state.selected?.mosque.saved || notice === "offline")
    refreshLocation();
});
window.addEventListener("offline", () => {
  if (selected) {
    session.state.notice = "offline";
    syncState(session.state);
  }
});
window.addEventListener("pagehide", () => {
  disarmAlert();
  session.cancel();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    session.tick();
    syncState(session.state);
  }
});
if (
  "serviceWorker" in navigator &&
  !preview &&
  (location.origin === "https://bilalathan.co.uk" ||
    ["localhost", "127.0.0.1"].includes(location.hostname))
)
  navigator.serviceWorker
    .register("/near-sw.js")
    .then(async () => {
      await navigator.serviceWorker.ready;
      for (const name of ["isha", "fajr", "dhuhr", "asr", "maghrib"])
        fetch(`sky/${name}.webp`).catch(() => {});
    })
    .catch(() => {});
if (preview) {
  const { startPreview } = await import("./near-preview.mjs");
  const at = query.get("at") || "18:04";
  previewNow = +(
    ukTime(dayKey(Date.now()), at) || ukTime(dayKey(Date.now()), "18:04")
  );
  await startPreview(session, previewNow, query.get("state"));
  syncState(session.state);
} else {
  syncState(session.state);
  session.start();
}
if (["ios", "android"].includes(query.get("install")))
  installUI.show(query.get("install"));
