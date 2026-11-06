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
  result.replaceChildren(card);
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
