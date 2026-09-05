export const preferenceKeys = {
  usual: "bilal-near.usual.v1",
  visit: "bilal-near.visit.v1",
};
const validId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id);
function read(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) || "null");
  } catch {
    return null;
  }
}
function write(storage, key, value) {
  try {
    if (!storage) return false;
    value == null
      ? storage.removeItem(key)
      : storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// Store intent, not a timetable, journey estimate, address or location trail.
export function createMosqueMemory({ local, session } = {}) {
  const saved = read(local, preferenceKeys.usual),
    visited = read(session, preferenceKeys.visit);
  let usual = saved?.version === 1 && validId(saved.id) ? saved.id : null;
  let visit =
    visited?.version === 1 && validId(visited.id) ? { id: visited.id } : null;
  return {
    get usual() {
      return usual;
    },
    get visit() {
      return visit;
    },
    remember(id) {
      if (
        !validId(id) ||
        !write(local, preferenceKeys.usual, { version: 1, id })
      )
        return false;
      usual = id;
      return true;
    },
    forget() {
      if (!write(local, preferenceKeys.usual, null)) return false;
      usual = null;
      return true;
    },
    choose(option) {
      visit = { id: option.mosque.id };
      return write(session, preferenceKeys.visit, { version: 1, ...visit });
    },
    clearVisit() {
      visit = null;
      return write(session, preferenceKeys.visit, null);
    },
  };
}
