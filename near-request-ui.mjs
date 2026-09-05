import { createMosqueRequest } from "./near-request.mjs";

export function attachMosqueRequest({
  sheet,
  actions,
  setCleanup,
  close,
  esc,
  preview = false,
  storage,
}) {
  const model = createMosqueRequest({
    storage,
    ...(preview
      ? {
          fetcher: async () => {
            throw new Error(
              "This is a design preview. Open Bilal Near to send your request.",
            );
          },
        }
      : {}),
  });
  const $ = (id) => document.getElementById(id);
  let emailDraft = "";
  function show(name = "") {
    if (!model.state.name && name) model.edit({ name });
    let page = "",
      unsub = () => {};
    function draw() {
      const state = model.state,
        next = state.emailSaved ? "done" : state.sent ? "email" : "details";
      if (next !== page) {
        page = next;
        // The parent sheet handles focus, safe areas, keyboard and dismissal.
        // Unsubscribe before replacing it, then attach only this view.
        unsub();
        if (next === "details") {
          sheet(
            "Add your mosque",
            `<p class="request-promise">If their website publishes prayer times, we’ll add your mosque within <strong>24 hours.</strong></p><form id="mosqueRequestForm" class="request-form" novalidate><label class="request-field" for="requestName"><span>Mosque name</span><input id="requestName" name="mosque" type="text" value="${esc(state.name)}" placeholder="What’s it called?" maxlength="160" autocomplete="off" enterkeyhint="next" aria-describedby="requestError"></label><label class="request-field" for="requestWebsite"><span>Their website</span><input id="requestWebsite" name="website" type="text" inputmode="url" value="${esc(state.url)}" placeholder="masjid.org.uk" maxlength="2048" autocomplete="url" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-describedby="websiteHint requestError"></label><p class="request-hint" id="websiteHint">The homepage, prayer-times page or a timetable PDF.</p><p class="field-error request-error" id="requestError" role="alert"></p></form>`,
          );
          actions(
            `<button class="solid request-submit" id="requestSubmit" type="submit" form="mosqueRequestForm"><span>Send mosque request</span><span aria-hidden="true">→</span></button>`,
          );
          $("requestName").oninput = () =>
            model.edit({ name: $("requestName").value });
          $("requestWebsite").oninput = () =>
            model.edit({ url: $("requestWebsite").value });
          $("requestName").onkeydown = (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              $("requestWebsite").focus({ preventScroll: true });
            }
          };
          $("mosqueRequestForm").onsubmit = async (event) => {
            event.preventDefault();
            model.edit({
              name: $("requestName").value,
              url: $("requestWebsite").value,
            });
            await model.submit();
            focusError();
          };
        } else if (next === "email") {
          sheet(
            "Request received",
            `<p class="request-receipt">${esc(state.name)}</p><p class="request-promise">We’ll check their website. If it publishes prayer times, your mosque will be on Bilal within <strong>24 hours.</strong></p><form id="mosqueEmailForm" class="request-form" novalidate><label class="request-field" for="requestEmail"><span>Email me when it’s live <small>Optional</small></span><input id="requestEmail" name="email" type="email" value="${esc(emailDraft)}" placeholder="you@example.com" maxlength="254" autocomplete="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-describedby="emailPurpose requestError"></label><p class="request-hint" id="emailPurpose">Just an update about this mosque. No mailing list.</p><p class="field-error request-error" id="requestError" role="alert"></p></form>`,
          );
          actions(
            `<button class="solid request-submit" id="requestSubmit" type="submit" form="mosqueEmailForm"><span>Notify me</span><span aria-hidden="true">→</span></button><button class="request-skip" id="requestDone" type="button">Done for now</button>`,
          );
          $("requestEmail").oninput = () => {
            emailDraft = $("requestEmail").value;
            $("requestEmail").removeAttribute("aria-invalid");
            $("requestError").textContent = "";
          };
          $("mosqueEmailForm").onsubmit = async (event) => {
            event.preventDefault();
            emailDraft = $("requestEmail").value;
            await model.notify(emailDraft);
            focusError();
          };
          $("requestDone").onclick = () => close(() => model.reset());
        } else {
          emailDraft = "";
          sheet(
            "We’ll let you know",
            `<p class="request-receipt">${esc(state.name)}</p><p class="request-promise">You’ll get an email when your mosque is on Bilal.</p><p class="request-hint">Thank you for helping more people find their jama’ah.</p><button class="text-link" id="requestAnother">Add another mosque</button>`,
          );
          actions(
            '<button class="solid" id="requestDone" type="button">Back to Bilal</button>',
          );
          $("requestDone").onclick = () => close(() => model.reset());
          $("requestAnother").onclick = () => {
            model.reset();
          };
        }
        page = next;
        $("sheet").dataset.view = "request";
        unsub = model.subscribe(draw);
        setCleanup(() => {
          unsub();
          page = "";
        });
      }
      const submit = $("requestSubmit"),
        form = $("mosqueRequestForm") || $("mosqueEmailForm");
      if (submit) {
        submit.disabled = !!state.busy;
        submit.querySelector("span").textContent = state.busy
          ? state.sent
            ? "Saving your email…"
            : "Sending…"
          : state.sent
            ? "Notify me"
            : "Send mosque request";
        submit.toggleAttribute("data-sending", !!state.busy);
      }
      if (state.id && !state.busy && !state.sent) {
        if ($("requestName")) $("requestName").value = state.name;
        if ($("requestWebsite")) $("requestWebsite").value = state.url;
      }
      if (!state.error)
        form
          ?.querySelectorAll("[aria-invalid]")
          .forEach((el) => el.removeAttribute("aria-invalid"));
      form?.setAttribute("aria-busy", String(!!state.busy));
      form
        ?.querySelectorAll("input")
        .forEach((el) => (el.readOnly = !!state.busy));
      if ($("requestError"))
        $("requestError").textContent = state.error?.message || "";
    }
    function focusError() {
      if (page === "" || !model.state.error) return;
      const id = {
        name: "requestName",
        url: "requestWebsite",
        email: "requestEmail",
      }[model.state.error.field];
      if (id && $(id)) {
        $(id).setAttribute("aria-invalid", "true");
        $(id).focus({ preventScroll: true });
      }
    }
    draw();
  }
  return { show };
}
