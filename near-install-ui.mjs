import {
  NEAR_URL,
  installContext,
  createInstallController,
} from "./near-install.mjs";

const glyph = (name) => {
  const paths = {
    share: "M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2",
    plus: "M12 7v10M7 12h10M4 4h16v16H4z",
    copy: "M8 8h12v13H8zM16 8V3H3v13h5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    menu: "M12 5v.01M12 12v.01M12 19v.01",
    arrow: "M5 19 19 5M6 5h13v13",
  };
  return `<svg class="icon install-glyph ${["more", "menu"].includes(name) ? "more-glyph" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
};

export function attachInstallUI({
  sheet,
  close,
  setCleanup,
  announce,
  reduced,
}) {
  const $ = (id) => document.getElementById(id);
  const display = matchMedia("(display-mode: standalone)");
  const context = installContext({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: navigator.standalone || display.matches,
  });
  let hasAnswer = true,
    guidePlatform = context.platform === "android" ? "android" : "ios";
  // Native installation is offered only on the production origin.
  const isLive =
    location.origin === new URL(NEAR_URL).origin &&
    !new URLSearchParams(location.search).has("preview");
  const controller = createInstallController({
    target: window,
    installed: context.installed,
    nativeEnabled: isLive,
    onChange: updateOffer,
    onInstalled() {
      announce("Bilal has been added. Open it from your Home Screen.");
      if ($("sheet").dataset.view === "install" && !$("overlay").hidden)
        close();
    },
  });
  function updateOffer() {
    const state = controller.state();
    $("installOffer").hidden = !hasAnswer || state.installed;
    $("installButton").disabled = state.pending;
    $("installLabel").textContent = state.pending
      ? "Opening install…"
      : "Add to Home Screen";
  }
  display.addEventListener("change", (e) => {
    if (e.matches) controller.complete();
  });

  function guideMarkup(platform) {
    const ios = platform === "ios";
    return `<ol class="install-steps">
   <li><span class="install-number" aria-hidden="true">1</span><div><h3>${ios ? "Open the Share menu" : "Open the Chrome menu"}</h3><p>${ios ? "In Safari, tap More, then Share. Some layouts show Share directly." : "In Chrome, tap the three dots beside the address bar."}</p><div class="install-menu-example" aria-hidden="true">${glyph(ios ? "more" : "menu")}<span class="install-path-arrow">→</span>${ios ? `<span>Share</span>${glyph("share")}` : "<span>Chrome menu</span>"}</div></div></li>
   <li><span class="install-number" aria-hidden="true">2</span><div><h3>${ios ? "Choose Add to Home Screen" : "Choose the install option"}</h3><p>${ios ? "Tap View More if shown, then scroll through the share options." : "Look for Install and create shortcut, or Add to Home screen."}</p><div class="install-menu-example install-menu-row" aria-hidden="true"><span>${ios ? "Add to Home Screen" : "Install and create shortcut"}</span>${glyph("plus")}</div></div></li>
   <li><span class="install-number" aria-hidden="true">3</span><div><h3>${ios ? "Keep it as an app" : "Install Bilal"}</h3><p>${ios ? "Leave Open as Web App on if shown, then tap Add." : "Choose Install and confirm. Next time, open Bilal from its icon."}</p><div class="install-app-example" aria-hidden="true"><img src="icon-192.png" width="36" height="36" alt=""><span>Bilal Near<small>Your next jama’ah, one tap away.</small></span><b>${ios ? "Add" : "Install"}</b></div></div></li>
  </ol><details class="install-help"><summary>${ios ? "Can’t see Add to Home Screen?" : "Can’t see an install option?"}</summary><p>${ios ? "At the bottom of the share menu, choose Edit Actions and add Add to Home Screen. If you’re in another browser or inside an app, open Bilal in Safari first." : "Open the link in Chrome itself, rather than inside another app. If only Create shortcut is offered, you can save a shortcut and still open Bilal from your Home Screen."}</p></details>`;
  }
  function show(platform = guidePlatform) {
    if (controller.state().installed) {
      announce("Bilal is already open as an app.");
      return;
    }
    guidePlatform = platform === "android" ? "android" : "ios";
    sheet(
      "Keep Bilal close.",
      `<p class="install-intro">Straight to your next jama’ah.<br>No account. No app store.</p>
   <div class="install-tabs" role="tablist" aria-label="Your phone"><span class="install-tab-line" aria-hidden="true"></span><button type="button" id="install-ios" role="tab" aria-controls="installGuide">iPhone</button><button type="button" id="install-android" role="tab" aria-controls="installGuide">Android</button></div>
   <div class="install-handoff" ${isLive && context.safari ? "hidden" : ""}><p id="installBrowserNote"></p><div class="install-url"><a id="liveNearLink" href="${NEAR_URL}" target="_blank" rel="noopener" aria-label="Open live Bilal Near (new tab)">bilalathan.co.uk/near${glyph("arrow")}</a><button type="button" id="copyNearLink" aria-label="Copy Bilal Near link">${glyph("copy")}</button></div><p id="installCopyStatus" class="sr-only" role="status"></p>${context.platform === "desktop" ? '<details class="install-qr"><summary>Open on your phone</summary><div><img src="near-qr.svg" alt="QR code for the live Bilal Near app" width="148" height="148"><p>Scan with your phone’s camera, then follow the steps below.</p></div></details>' : ""}</div>
   <section id="installGuide" class="install-guide" role="tabpanel" tabindex="0"></section><button type="button" class="install-return" id="installReturn">Back to nearby jama’ahs<span aria-hidden="true">→</span></button>`,
    );
    $("sheet").dataset.view = "install";
    $("installButton").setAttribute("aria-expanded", "true");
    let copyAttempt = 0;
    function select(platform, focus = false) {
      guidePlatform = platform;
      for (const key of ["ios", "android"]) {
        const tab = $(`install-${key}`);
        tab.setAttribute("aria-selected", String(key === platform));
        tab.tabIndex = key === platform ? 0 : -1;
      }
      $("installGuide").setAttribute("aria-labelledby", `install-${platform}`);
      $("sheet").style.setProperty("--install-tab", platform === "ios" ? 0 : 1);
      $("installBrowserNote").textContent =
        `First, open Bilal in ${platform === "ios" ? "Safari" : "Chrome"}${context.platform === "desktop" ? " on your phone" : ""}.`;
      const panel = $("installGuide");
      panel.innerHTML = guideMarkup(platform);
      if (focus) {
        $(`install-${platform}`).focus({ preventScroll: true });
        if (!reduced.matches)
          panel.animate(
            [
              { opacity: 0.45, transform: "translateY(3px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 180, easing: "cubic-bezier(.22,.8,.25,1)" },
          );
      }
    }
    for (const key of ["ios", "android"]) {
      const tab = $(`install-${key}`);
      tab.onclick = () => select(key, true);
      tab.onkeydown = (e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          select(
            e.key === "Home"
              ? "ios"
              : e.key === "End"
                ? "android"
                : guidePlatform === "ios"
                  ? "android"
                  : "ios",
            true,
          );
        }
      };
    }
    $("copyNearLink").onclick = async () => {
      const button = $("copyNearLink"),
        status = $("installCopyStatus"),
        attempt = ++copyAttempt;
      try {
        await navigator.clipboard.writeText(NEAR_URL);
        if (!button.isConnected || attempt !== copyAttempt) return;
        status.textContent = "Link copied. Paste it into Safari or Chrome.";
        button.setAttribute("aria-label", "Bilal Near link copied");
        button.classList.add("copied");
        button.innerHTML = '<span aria-hidden="true">✓</span>';
      } catch {
        if (!button.isConnected || attempt !== copyAttempt) return;
        status.className = "install-copy-fallback";
        status.innerHTML = `Copy this address: <input aria-label="Bilal Near address" value="${NEAR_URL}" readonly>`;
        const input = status.querySelector("input");
        input.focus();
        input.select();
      }
    };
    $("installReturn").onclick = () => close();
    setCleanup(() => {
      copyAttempt++;
      $("installButton").setAttribute("aria-expanded", "false");
    });
    select(guidePlatform);
  }
  $("installButton").onclick = async () => {
    const result = await controller.request();
    if (result === "guide") show();
    else if (result === "dismissed")
      announce("You can add Bilal whenever you’re ready.");
    else if (result === "accepted")
      announce("Finish adding Bilal in your browser.");
  };
  return {
    show,
    refresh(options) {
      hasAnswer = options.hasAnswer;
      updateOffer();
    },
    installed: () => controller.state().installed,
  };
}
