// ShipTrack Lite: browser code
//
// When the tracking form is submitted:
//   1. Stop the browser's default behavior (reloading the page)
//   2. Ask our server for the shipment:  GET /api/shipments/<number>
//   3. Show the result (or an error message) on the page

const form = document.querySelector("#track-form");
const input = document.querySelector("#tracking-number");
const button = form.querySelector("button");
const result = document.querySelector("#result");

form.addEventListener("submit", async (event) => {
  // Without this line, the browser would reload the page and we'd lose everything.
  event.preventDefault();

  const trackingNumber = input.value.trim();
  if (!trackingNumber) return;

  showMessage("Searching…", "loading");
  button.disabled = true; // prevent double-clicks while we wait

  try {
    // encodeURIComponent makes the text safe to put inside a URL.
    const response = await fetch(`/api/shipments/${encodeURIComponent(trackingNumber)}`);
    const data = await response.json();

    if (response.ok) {
      showShipment(data); // status 200
    } else {
      showMessage(data.error, "error"); // status 400 or 404
    }
  } catch {
    // fetch itself failed: the server is down or the internet is off.
    showMessage("Could not reach the server. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

// --- Display helpers ------------------------------------------------------
//
// SECURITY: we build the page with createElement + textContent, never by
// putting text into innerHTML. textContent always treats data as plain text,
// so even if the data contained <script> tags, they would be shown,
// not executed. (This prevents an attack called XSS.)

function showMessage(text, type) {
  result.replaceChildren(createElement("p", text, `message message-${type}`));
}

function showShipment(shipment) {
  const card = createElement("div", "", "shipment-card");

  const header = createElement("div", "", "shipment-header");
  header.append(
    createElement("h3", shipment.trackingNumber),
    createElement("span", shipment.status, `status status-${toCssName(shipment.status)}`),
  );

  const details = createElement("dl", "", "shipment-details");
  addDetail(details, "From", shipment.origin);
  addDetail(details, "To", shipment.destination);
  addDetail(details, "Estimated delivery", formatDate(shipment.estimatedDelivery));

  const historyTitle = createElement("h4", "History");
  const timeline = createElement("ol", "", "timeline");

  // Show the newest event first: copy the list, then reverse the copy.
  for (const item of [...shipment.events].reverse()) {
    const li = createElement("li");
    li.append(
      createElement("strong", item.description),
      createElement("span", `${item.location} · ${formatDateTime(item.date)}`),
    );
    timeline.append(li);
  }

  card.append(header, details, historyTitle, timeline);

  // The server only includes "saved" for visitors who are logged in.
  if (typeof shipment.saved === "boolean") card.append(createSaveAction(shipment));

  result.replaceChildren(card);
}

function createSaveAction(shipment) {
  const box = createElement("div", "", "shipment-actions");

  if (shipment.saved) {
    box.append(createSavedLink());
    return box;
  }

  const saveButton = createElement("button", "Save to My shipments", "button-secondary");
  saveButton.type = "button";
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      const response = await fetch("/api/my-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: shipment.trackingNumber }),
      });

      if (response.ok) {
        box.replaceChildren(createSavedLink());
      } else {
        box.replaceChildren(saveButton, createElement("p", (await response.json()).error, "save-error"));
      }
    } catch {
      box.replaceChildren(saveButton, createElement("p", "Could not reach the server. Please try again.", "save-error"));
    } finally {
      saveButton.disabled = false;
    }
  });

  box.append(saveButton);
  return box;
}

function createSavedLink() {
  const link = createElement("a", "Saved. View My shipments", "saved-link");
  link.href = "/my-shipments";
  return link;
}

function createElement(tag, text = "", className = "") {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function addDetail(list, label, value) {
  list.append(createElement("dt", label), createElement("dd", value));
}

// "In Transit" → "in-transit" (used to pick a color in CSS)
function toCssName(text) {
  return text.toLowerCase().replaceAll(" ", "-");
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// --- When the page opens --------------------------------------------------

// The sample number only appears when the server is in demo mode.
async function showDemoHint() {
  try {
    const { demoMode } = await (await fetch("/api/config")).json();
    document.querySelector("#demo-hint").hidden = !demoMode;
  } catch {
    // The hint is optional, so it's fine to leave it hidden.
  }
}

// Links like /?track=ST10000001 open with that shipment showing.
const trackFromUrl = new URLSearchParams(window.location.search).get("track");
if (trackFromUrl) {
  input.value = trackFromUrl;
  form.requestSubmit();
}

// --- Home page extras -----------------------------------------------------

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The live numbers, counted up from zero. Shown only once they've loaded.
async function showStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return;
    const stats = await response.json();
    for (const element of document.querySelectorAll("[data-stat]")) {
      countUp(element, stats[element.dataset.stat] ?? 0);
    }
    document.querySelector("#stats-band").hidden = false;
  } catch {
    // The numbers are extra, so the page works fine without them.
  }
}

function countUp(element, target) {
  if (prefersReducedMotion || target === 0) {
    element.textContent = target.toLocaleString();
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / 900, 1);
    const eased = 1 - (1 - progress) ** 3; // fast at first, then gently slowing down
    element.textContent = Math.round(target * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Logged-in visitors don't need "Create an account", so point them to their list.
async function personalizeForLoggedInVisitors() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    for (const element of document.querySelectorAll("[data-hide-when-logged-in]")) element.hidden = true;
    for (const link of document.querySelectorAll("[data-signup-link]")) {
      link.href = "/my-shipments";
      link.textContent = link.dataset.loggedInText;
    }
  } catch {
    // Keep the sign-up links.
  }
}

// The example card plays its animation once, when it scrolls into view.
// Without JavaScript, or for people who prefer less motion, it simply
// shows the finished card.
function playPreviewWhenVisible() {
  const preview = document.querySelector("#preview");
  if (!preview || prefersReducedMotion || !("IntersectionObserver" in window)) return;

  preview.classList.add("will-animate");
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      preview.classList.add("is-playing");
      observer.disconnect();
    }
  }, { threshold: 0.4 });
  observer.observe(preview);
}

showDemoHint();
showStats();
personalizeForLoggedInVisitors();
playPreviewWhenVisible();
