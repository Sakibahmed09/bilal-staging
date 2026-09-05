import { createDataService, locate, nearby, distance } from "./near-data.mjs";
import { mosqueFrom, moment, resolveMosque, recommend } from "./near-model.mjs";
import { dayKey } from "./near-time.mjs";

// The request generation owns every result. A late GPS fix or slow response
// from an earlier search cannot move someone back to an old area.
export function createNearSession({
  data = createDataService(),
  getLocation = locate,
  memory,
  now = Date.now,
  onChange = () => {},
} = {}) {
  const state = {
    pool: [],
    catalogue: [],
    selected: null,
    scenario: moment([], now() / 60000),
    custom: {},
    here: null,
    area: "Your location",
    screen: "locate",
    notice: null,
    reason: "nearby",
    busy: false,
    explicit: false,
    unavailable: [],
  };
  let generation = 0,
    controller = null;
  const emit = () => onChange(state);
  function cancel() {
    generation++;
    controller?.abort();
    state.busy = false;
  }
  function choose(option) {
    state.selected = option;
    state.explicit = true;
    state.reason = "visit";
    memory?.choose(option);
    emit();
  }
  function tick() {
    const previous = state.scenario;
    state.scenario = moment(state.pool, now() / 60000);
    const today = dayKey(now());
    for (const m of state.pool)
      m.times = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map(
        (p) =>
          m.schedule.find((o) => o.date === today && o.prayer === p)?.at ??
          null,
      );
    if (state.selected) {
      if (
        (!state.explicit && state.selected.at < state.scenario.now - 15) ||
        previous.prayer !== state.scenario.prayer ||
        previous.prayerDate !== state.scenario.prayerDate
      ) {
        const next = recommend(
          [state.selected.mosque],
          state.scenario,
          state.custom,
        );
        if (next) state.selected = next;
      }
    }
    return state;
  }
  async function start({ place = null, refresh = false } = {}) {
    cancel();
    const token = generation;
    controller = new AbortController();
    const signal = controller.signal;
    const retained = state.selected
      ? { id: state.selected.mosque.id }
      : memory?.visit;
    state.busy = true;
    if (!state.selected) state.screen = place ? "loading" : "locate";
    emit();
    const [directory, position] = await Promise.allSettled([
      data.directory({ signal }),
      place
        ? Promise.resolve({ lat: Number(place.lat), lng: Number(place.lng) })
        : getLocation({ signal, fresh: refresh }),
    ]);
    if (token !== generation) return;
    if (directory.status === "rejected") {
      state.busy = false;
      state.notice = state.selected ? "refreshError" : null;
      if (!state.selected) state.screen = "failure";
      emit();
      return;
    }
    state.catalogue = directory.value;
    let candidates,
      here,
      area,
      locationFailed = false;
    if (position.status === "fulfilled") {
      here = position.value;
      area = place?.label || "Where you are now";
      candidates = nearby(state.catalogue, here, [retained?.id, memory?.usual]);
    } else if (state.selected) {
      // Preserve a useful answer when GPS is denied or unavailable; never
      // claim the location was refreshed using the old coordinates.
      state.busy = false;
      state.notice = "locationError";
      emit();
      return;
    } else {
      const preferred = state.catalogue.find(
        (m) => m.g === (retained?.id || memory?.usual),
      );
      if (!preferred) {
        state.busy = false;
        state.screen =
          position.reason?.code === "permission" ? "permission" : "location";
        emit();
        return;
      }
      candidates = [preferred];
      here = null;
      area = "Location unavailable";
      locationFailed = true;
    }
    if (!candidates.length) {
      state.busy = false;
      if (state.selected) state.notice = "emptyArea";
      else state.screen = "empty";
      emit();
      return;
    }
    if (!state.selected) {
      state.screen = "loading";
      emit();
    }
    const responses = await Promise.all(
      candidates.map(async (m) => {
        try {
          return {
            m,
            result: await data.times(m.g, { signal, force: refresh }),
          };
        } catch (error) {
          return { m, error };
        }
      }),
    );
    if (token !== generation) return;
    const clock = now() / 60000,
      pool = responses
        .filter((r) => r.result)
        .map((r) => mosqueFrom(r.m, r.result, clock));
    const scenario = moment(pool, clock);
    const custom =
      state.here &&
      here &&
      distance(state.here, { y: here.lat, x: here.lng }) < 250
        ? state.custom
        : {};
    const resolved = resolveMosque({
      pool,
      scenario,
      custom,
      visit: retained,
      usual: memory?.usual,
    });
    state.busy = false;
    if (!resolved.option) {
      if (state.selected) {
        state.notice = responses.some((r) => r.error?.code === "network")
          ? "refreshError"
          : "timesUnavailable";
        emit();
        return;
      }
      state.pool = pool;
      state.unavailable = responses;
      state.here = here;
      state.area = area;
      state.scenario = scenario;
      state.screen = responses.some((r) => r.error?.code === "network")
        ? "failure"
        : "empty";
      emit();
      return;
    }
    Object.assign(state, {
      pool,
      scenario,
      custom,
      here,
      area,
      selected: resolved.option,
      reason: resolved.reason,
      screen: null,
      explicit: false,
      unavailable: responses.filter(
        (r) => r.error || !pool.find((m) => m.id === r.m.g)?.usable,
      ),
    });
    state.notice = locationFailed
      ? "locationUnknown"
      : resolved.option.mosque.saved
        ? "offline"
        : responses.some((r) => r.error?.code === "network")
          ? "partialNetwork"
          : null;
    emit();
  }
  function selectJourney(value) {
    if (state.selected) {
      if (value == null) delete state.custom[state.selected.mosque.id];
      else state.custom[state.selected.mosque.id] = value;
      emit();
    }
  }
  async function checkMosque(source) {
    const token = generation;
    const result = await data.times(source.g, { signal: controller?.signal });
    if (token !== generation) return null;
    const m = mosqueFrom(
      {
        ...source,
        _d: state.here ? distance(state.here, source) / 1000 : undefined,
      },
      result,
      now() / 60000,
    );
    const previous = state.pool.findIndex((o) => o.id === m.id);
    if (previous < 0) state.pool.push(m);
    else state.pool[previous] = m;
    state.scenario = moment(state.pool, now() / 60000);
    emit();
    return m;
  }
  return {
    state,
    start,
    cancel,
    choose,
    tick,
    selectJourney,
    checkMosque,
    data,
    now,
  };
}
