// Admin dashboard: list shipments, create them, and post status updates.
//
// Hiding this page from customers is only a courtesy. The real protection is
// on the server: every /api/admin request is checked there.

const loading = document.querySelector("#admin-loading");
const denied = document.querySelector("#admin-denied");
const app = document.querySelector("#admin-app");
const messageBox = document.querySelector("#admin-message");
const rows = document.querySelector("#shipment-rows");
const noShipments = document.querySelector("#no-shipments");
const search = document.querySelector("#search");
const title = document.querySelector("#admin-title");
const statusFilters = document.querySelector("#status-filters");

const createDialog = document.querySelector("#create-dialog");
const createForm = document.querySelector("#create-form");
const updateDialog = document.querySelector("#update-dialog");
const updateForm = document.querySelector("#update-form");
const updateTitle = document.querySelector("#update-title");
const statusSelect = document.querySelector("#status");

let shipments = [];
let updatingTrackingNumber = null;
let activeStatus = null; // null means "All shipments"
const filters = []; // one entry per sidebar button

// --- Loading --------------------------------------------------------------

async function loadShipments() {
  let response;
  try {
    response = await fetch("/api/admin/shipments");
  } catch {
    loading.textContent = "Could not reach the server. Please refresh the page.";
    return;
  }

  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }

  loading.hidden = true;

  if (response.status === 403) {
    denied.hidden = false;
    return;
  }

  if (!response.ok) {
    loading.hidden = false;
    loading.textContent = "Something went wrong. Please refresh the page.";
    return;
  }

  const data = await response.json();
  shipments = data.shipments;
  fillStatusOptions(data.statuses);
  buildFilters(data.statuses);
  renderRows();
  app.hidden = false;
}

function fillStatusOptions(statuses) {
  statusSelect.replaceChildren(
    ...statuses.map((status) => {
      const option = document.createElement("option");
      option.textContent = status;
      return option;
    }),
  );
}

// --- Sidebar filters ------------------------------------------------------

// The buttons are built once and then only updated, so a keyboard user's
// focus stays on the button they just pressed.
function buildFilters(statuses) {
  for (const status of [null, ...statuses]) {
    const dot = document.createElement("span");
    dot.className = status ? `filter-dot dot-${toCssName(status)}` : "filter-dot";

    const count = document.createElement("span");
    count.className = "filter-count";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter";
    button.append(dot, status ?? "All shipments", count);
    button.addEventListener("click", () => {
      activeStatus = status;
      renderRows();
    });

    const item = document.createElement("li");
    item.append(button);
    statusFilters.append(item);
    filters.push({ status, button, count });
  }
}

function updateFilters() {
  for (const { status, button, count } of filters) {
    count.textContent = status ? shipments.filter((s) => s.status === status).length : shipments.length;
    button.setAttribute("aria-pressed", String(status === activeStatus));
  }
  title.textContent = activeStatus ?? "All shipments";
}

// "In Transit" → "in-transit" (used to pick a color in CSS)
function toCssName(text) {
  return text.toLowerCase().replaceAll(" ", "-");
}

// --- Table ----------------------------------------------------------------

function renderRows() {
  const query = search.value.trim().toLowerCase();
  const visible = shipments.filter((shipment) =>
    (!activeStatus || shipment.status === activeStatus) &&
    [shipment.trackingNumber, shipment.status, shipment.origin, shipment.destination]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );

  rows.replaceChildren(...visible.map(createRow));
  noShipments.hidden = visible.length > 0;
  updateFilters();
}

// Built with textContent, so anything typed into a shipment stays plain text.
function createRow(shipment) {
  const row = document.createElement("tr");

  const badge = document.createElement("span");
  badge.className = `status status-${toCssName(shipment.status)}`;
  badge.textContent = shipment.status;

  const updateButton = document.createElement("button");
  updateButton.type = "button";
  updateButton.className = "button-secondary";
  updateButton.textContent = "Update";
  updateButton.setAttribute("aria-label", `Update ${shipment.trackingNumber}`);
  updateButton.addEventListener("click", () => openUpdateDialog(shipment));

  row.append(
    createCell(shipment.trackingNumber),
    createCell(badge),
    createCell(shipment.origin),
    createCell(shipment.destination),
    createCell(formatDate(shipment.estimatedDelivery)),
    createCell(updateButton),
  );
  return row;
}

function createCell(content) {
  const cell = document.createElement("td");
  cell.append(content);
  return cell;
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

// --- Forms ----------------------------------------------------------------

document.querySelector("#new-shipment").addEventListener("click", () => {
  createForm.reset();
  hideFormError(createForm);
  createDialog.showModal();
});

function openUpdateDialog(shipment) {
  updatingTrackingNumber = shipment.trackingNumber;
  updateForm.reset();
  hideFormError(updateForm);
  updateTitle.textContent = `Update ${shipment.trackingNumber}`;
  statusSelect.value = shipment.status;
  updateDialog.showModal();
}

for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}

createForm.addEventListener("submit", (event) => {
  submitForm(event, createDialog, "/api/admin/shipments", (shipment) => `Created ${shipment.trackingNumber}.`);
});

updateForm.addEventListener("submit", (event) => {
  const url = `/api/admin/shipments/${encodeURIComponent(updatingTrackingNumber)}/events`;
  submitForm(event, updateDialog, url, (shipment) => `Updated ${shipment.trackingNumber}.`);
});

async function submitForm(event, dialog, url, successMessage) {
  event.preventDefault();

  const form = event.target;
  const button = form.querySelector("button[type=submit]");
  hideFormError(form);
  button.disabled = true;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await response.json();

    if (!response.ok) {
      showFormError(form, data.error);
      return;
    }

    dialog.close();
    showMessage(successMessage(data.shipment));
    await refreshShipments();
  } catch {
    showFormError(form, "Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
  }
}

async function refreshShipments() {
  const response = await fetch("/api/admin/shipments");
  if (!response.ok) return;
  shipments = (await response.json()).shipments;
  renderRows();
}

function showFormError(form, message) {
  const box = form.querySelector(".form-error");
  box.textContent = message;
  box.hidden = false;
}

function hideFormError(form) {
  form.querySelector(".form-error").hidden = true;
}

function showMessage(text) {
  const message = document.createElement("p");
  message.className = "message message-success";
  message.textContent = text;
  messageBox.replaceChildren(message);
}

search.addEventListener("input", renderRows);

loadShipments();
