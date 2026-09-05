// Restores the original Near entrance. Real work advances the line; the veil
// gives way to the usable loading page after 1.45s, even if GPS is still busy.
export function createOpening({
  viewport,
  screen,
  standalone,
  reduced,
  preview,
  onSearch,
}) {
  const root = viewport.querySelector(".splash"),
    status = viewport.querySelector("#splashStatus"),
    progress = viewport.querySelector("#splashProgress");
  let started = performance.now(),
    closed = false,
    dismissing = false,
    finishTimer,
    hideTimer,
    maximumTimer,
    statusAnimation;
  const minimum = reduced.matches ? 0 : standalone ? 180 : 900;
  function dismiss({ message, immediate = false } = {}) {
    if (closed) return;
    if (message) stage(message, 1);
    if (dismissing && !immediate) return;
    dismissing = true;
    clearTimeout(maximumTimer);
    clearTimeout(finishTimer);
    const finish = () => {
      closed = true;
      document.body.classList.remove("is-loading");
      screen.inert = false;
      root.classList.add("out");
      if (immediate || reduced.matches) {
        viewport.hidden = true;
        return;
      }
      const answer = screen.querySelector("#answer:not([hidden])");
      answer?.animate(
        [
          { opacity: 0.02, transform: "translateY(7px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 760, easing: "cubic-bezier(.16,1,.3,1)" },
      );
      hideTimer = setTimeout(() => {
        viewport.hidden = true;
      }, 300);
    };
    if (immediate) finish();
    else
      finishTimer = setTimeout(
        finish,
        Math.max(0, minimum - (performance.now() - started)),
      );
  }
  function stage(message, amount) {
    if (closed || dismissing) return;
    if (status.textContent !== message) {
      status.textContent = message;
      if (!reduced.matches) {
        statusAnimation?.cancel();
        statusAnimation = status.animate(
          [
            { opacity: 0.28, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 420,
            easing: "cubic-bezier(.16,1,.3,1)",
            fill: "forwards",
          },
        );
      }
    }
    progress.style.transform = `scaleX(${Math.max(0.08, Math.min(1, amount))})`;
  }
  function update(state) {
    if (closed || dismissing) return;
    if (!state.busy && !state.screen && state.selected)
      dismiss({ message: "your next jama’ah is ready" });
    else if (
      state.screen === "loading" ||
      (state.busy && state.progress?.total)
    )
      stage(
        "checking jama’ah nearby",
        0.16 +
          (0.76 * (state.progress?.done || 0)) /
            Math.max(1, state.progress?.total || 1),
      );
    else if (state.screen === "locate" || state.busy)
      stage("finding where you are", 0.08);
    else if (!["locate", "loading"].includes(state.screen))
      dismiss({ immediate: true });
  }
  viewport.querySelector("#splashPlace").onclick = () => {
    dismiss({ immediate: true });
    onSearch();
  };
  function show(message = "finding where you are") {
    clearTimeout(finishTimer);
    clearTimeout(hideTimer);
    clearTimeout(maximumTimer);
    started = performance.now();
    closed = false;
    dismissing = false;
    viewport.hidden = false;
    root.classList.remove("out");
    screen.inert = true;
    document.body.classList.add("is-loading");
    stage(message, 0.08);
    maximumTimer = setTimeout(() => dismiss(), 1450);
  }
  if (preview) dismiss({ immediate: true });
  else show();
  return {
    show,
    update,
    dismiss,
    get visible() {
      return !closed;
    },
    destroy() {
      clearTimeout(finishTimer);
      clearTimeout(hideTimer);
      clearTimeout(maximumTimer);
      statusAnimation?.cancel();
      dismiss({ immediate: true });
    },
  };
}
