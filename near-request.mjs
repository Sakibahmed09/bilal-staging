// The receipt belongs to this browser tab. No email or location is persisted
// on the device; retries carry the same capability and cannot duplicate a row.
export const REQUEST_ENDPOINT =
  "https://bilal-times.ahmed-sakib.workers.dev/v1/mosque-requests";
const STORAGE_KEY = "bilal-near.request.v1";
export function mosqueName(value) {
  const name = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 160 || /[\x00-\x1f\x7f]/.test(name))
    throw Object.assign(new Error("What is the mosque called?"), {
      field: "name",
    });
  return name;
}
export function mosqueWebsite(value) {
  let raw = String(value || "").trim();
  try {
    if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = "https://" + raw;
    const url = new URL(raw),
      host = url.hostname;
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      raw.length > 2048 ||
      /\s/.test(raw) ||
      !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(host)
    )
      throw 0;
    url.hash = "";
    return url.href;
  } catch {
    throw Object.assign(
      new Error(
        "Add their website, such as masjid.org.uk. A prayer-times page or PDF link works too.",
      ),
      { field: "url" },
    );
  }
}
export function notificationEmail(value) {
  const email = String(value || "").trim();
  if (
    email.length > 254 ||
    !/^[^\s@<>]+@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i.test(email)
  )
    throw Object.assign(
      new Error("Check your email address, including the part after @."),
      { field: "email" },
    );
  return email;
}
export function createMosqueRequest({
  storage,
  fetcher = fetch,
  endpoint = REQUEST_ENDPOINT,
  uuid = () => crypto.randomUUID(),
  now = Date.now,
} = {}) {
  let state = { name: "", url: "", sent: false, emailSaved: false },
    listeners = new Set(),
    pending;
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (
      saved &&
      now() - saved.savedAt < 7 * 86400000 &&
      typeof saved.name === "string" &&
      typeof saved.url === "string"
    ) {
      state = {
        name: saved.name.slice(0, 160),
        url: saved.url.slice(0, 2048),
        id: saved.id,
        token: saved.token,
        sent: !!saved.sent,
        emailSaved: !!saved.emailSaved,
        receivedAt: saved.receivedAt,
      };
    }
  } catch {}
  function emit() {
    for (const fn of [...listeners]) fn(state);
  }
  function save() {
    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...state,
          error: undefined,
          busy: undefined,
          savedAt: now(),
        }),
      );
    } catch {}
  }
  function edit(fields) {
    if (state.sent || state.busy) return;
    // Editing after an uncertain response is a new request. An unchanged
    // retry keeps its id, including after a page reload.
    if (
      (fields.name != null && fields.name !== state.name) ||
      (fields.url != null && fields.url !== state.url)
    ) {
      state.id = undefined;
      state.token = undefined;
    }
    Object.assign(state, fields);
    state.error = null;
    save();
    emit();
  }
  async function post(path, body) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 14000);
    try {
      const response = await fetcher(endpoint + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        const message =
          response.status === 429
            ? "A few requests arrived together. Wait a minute, then try again."
            : response.status === 400
              ? "Check the details and try again."
              : "That didn’t send. Your details are still here—check your connection and try again.";
        throw new Error(message);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError" || error instanceof TypeError)
        throw new Error(
          "That didn’t send. Your details are still here—check your connection and try again.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function transact(action) {
    if (pending) return pending;
    state.busy = true;
    state.error = null;
    emit();
    pending = (async () => {
      try {
        await action();
        save();
        return true;
      } catch (error) {
        state.error = { message: error.message, field: error.field };
        return false;
      } finally {
        pending = null;
        state.busy = false;
        emit();
      }
    })();
    return pending;
  }
  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    edit,
    reset(name = "") {
      if (state.busy) return;
      state = {
        name: String(name).slice(0, 160),
        url: "",
        sent: false,
        emailSaved: false,
      };
      save();
      emit();
    },
    submit() {
      if (state.sent) return Promise.resolve(true);
      return transact(async () => {
        state.name = mosqueName(state.name);
        state.url = mosqueWebsite(state.url);
        state.id ||= uuid();
        state.token ||= uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
        save();
        const result = await post("", {
          id: state.id,
          token: state.token,
          name: state.name,
          url: state.url,
        });
        if (
          result.id !== state.id ||
          !Number.isFinite(Date.parse(result.receivedAt))
        )
          throw new Error(
            "We couldn’t confirm receipt. Try again; the same request won’t be added twice.",
          );
        state.sent = true;
        state.receivedAt = result.receivedAt;
      });
    },
    notify(email) {
      if (!state.sent || state.emailSaved) return Promise.resolve(false);
      return transact(async () => {
        const value = notificationEmail(email);
        try {
          await post("/" + state.id + "/email", {
            token: state.token,
            email: value,
          });
        } catch (error) {
          throw new Error(
            "Your mosque request is saved. Your email didn’t save—check your connection and try again.",
          );
        }
        state.emailSaved = true;
      });
    },
  };
}
