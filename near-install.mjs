export const NEAR_URL = "https://bilalathan.co.uk/near";

export function installContext({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  standalone = false,
} = {}) {
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const android = /Android/i.test(userAgent);
  const embedded = /FBAN|FBAV|Instagram|Line\/|; wv\)|WebView/i.test(userAgent);
  const safari =
    ios &&
    /Safari/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(userAgent) &&
    !embedded;
  return {
    platform: ios ? "ios" : android ? "android" : "desktop",
    safari,
    embedded,
    installed: Boolean(standalone),
  };
}

// A browser invitation is single-use. Accepting it is not installation proof.
// Manual instructions never mark a device as installed or suppress the offer.
export function createInstallController({
  target,
  installed = false,
  nativeEnabled = true,
  onChange = () => {},
  onInstalled = () => {},
}) {
  let deferred = null,
    pending = false,
    finished = installed,
    disposed = false;
  const state = () => ({
    installed: finished,
    pending,
    available: Boolean(deferred),
  });
  const notify = () => {
    if (!disposed) onChange(state());
  };
  function beforePrompt(event) {
    if (!nativeEnabled || finished) return;
    event.preventDefault();
    deferred = event;
    notify();
  }
  function complete() {
    if (finished || disposed) return;
    finished = true;
    pending = false;
    deferred = null;
    notify();
    onInstalled();
  }
  async function request() {
    if (finished) return "installed";
    if (pending) return "pending";
    if (!deferred) return "guide";
    const invitation = deferred;
    deferred = null;
    pending = true;
    notify();
    try {
      await invitation.prompt();
      const choice = await invitation.userChoice;
      // Only appinstalled / standalone removes the invitation.
      return finished
        ? "installed"
        : choice.outcome === "accepted"
          ? "accepted"
          : "dismissed";
    } catch {
      return "guide";
    } finally {
      pending = false;
      notify();
    }
  }
  target.addEventListener("beforeinstallprompt", beforePrompt);
  target.addEventListener("appinstalled", complete);
  return {
    state,
    request,
    complete,
    destroy() {
      disposed = true;
      deferred = null;
      target.removeEventListener("beforeinstallprompt", beforePrompt);
      target.removeEventListener("appinstalled", complete);
    },
  };
}
