// Admin dashboard: find, create, edit, update, and delete shipments.
//
// The server does the searching and sends one page at a time, so this keeps
// working with any number of shipments. Hiding this page from customers is only
// a courtesy: the real protection is on the server, for every /api/admin request.

const SHIPMENTS_URL = "/api/admin/shipments";
const SEARCH_DELAY_MS = 250;

const loading = document.querySelector("#admin-loading");
const denied = document.querySelector("#admin-denied");
const app = document.querySelector("#admin-app");
const messageBox = document.querySelector("#admin-message");
const rows = document.querySelector("#shipment-rows");
const noShipments = document.querySelector("#no-shipments");
const search = document.querySelector("#search");
const title = document.querySelector("#admin-title");
const statusFilters = document.querySelector("#status-filters");

const pager = document.querySelector("#pager");
const pagerInfo = document.querySelector("#pager-info");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");

const createDialog = document.querySelector("#create-dialog");
const createForm = document.querySelector("#create-form");
const editDialog = document.querySelector("#edit-dialog");
const editForm = document.querySelector("#edit-form");
const editTitle = document.querySelector("#edit-title");
const updateDialog = document.querySelector("#update-dialog");
const updateForm = document.querySelector("#update-form");
const updateTitle = document.querySelector("#update-title");
const statusSelect = document.querySelector("#status");
const deleteDialog = document.querySelector("#delete-dialog");
const deleteForm = document.querySelector("#delete-form");
const deleteTitle = document.querySelector("#delete-title");

const filters = []; // one entry per sidebar button
let currentPage = 1;
let activeStatus = null; // null means "All shipments"
let selectedTrackingNumber = null; // the shipment an open dialog is about
let latestRequest = 0;
let searchTimer = null;

// --- Loading --------------------------------------------------------------

async function loadShipments() {
  // Fast typing can start several requests, and they can finish out of order.
  // Only the most recent one is allowed to change the page.
  latestRequest += 1;
  const thisRequest = latestRequest;

  const params = new URLSearchParams({ page: currentPage });
  if (search.value.trim()) params.set("search", search.value.trim());
  if (activeStatus) params.set("status", activeStatus);

  try {
    const response = await fetch(`${SHIPMENTS_URL}?${params}`);
    if (thisRequest !== latestRequest) return;

    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (response.status === 403) {
      loading.hidden = true;
      app.hidden = true;
      denied.hidden = false;
      return;
    }
    if (!response.ok) {
      showLoadProblem("Something went wrong. Please refresh the page.");
      return;
    }

    const data = await response.json();
    if (thisRequest !== latestRequest) return;
    showResults(data);
  } catch {
    if (thisRequest === latestRequest) showLoadProblem("Could not reach the server. Please refresh the page.");
  }
}

function showLoadProblem(text) {
  if (app.hidden) {
    loading.textContent = text;
  } else {
    showMessage(text, "error");
  }
}

function showResults(data) {
  if (filters.length === 0) {
    fillStatusOptions(data.statuses);
    buildFilters(data.statuses);
  }

  // The server may give an earlier page, e.g. after deleting the last row of the last page.
  currentPage = data.page;

  rows.replaceChildren(...data.shipments.map(createRow));
  noShipments.hidden = data.shipments.length > 0;
  updateFilters(data.counts);
  updatePager(data);

  loading.hidden = true;
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
      currentPage = 1;
      loadShipments();
    });

    const item = document.createElement("li");
    item.append(button);
    statusFilters.append(item);
    filters.push({ status, button, count });
  }
}

function updateFilters(counts) {
  for (const { status, button, count } of filters) {
    count.textContent = status ? (counts.byStatus[status] ?? 0) : counts.all;
    button.setAttribute("aria-pressed", String(status === activeStatus));
  }
  title.textContent = activeStatus ?? "All shipments";
}

// "In Transit" → "in-transit" (used to pick a color in CSS)
function toCssName(text) {
  return text.toLowerCase().replaceAll(" ", "-");
}

// --- Table and paging -----------------------------------------------------

// Built with textContent, so anything typed into a shipment stays plain text.
function createRow(shipment) {
  const row = document.createElement("tr");

  const badge = document.createElement("span");
  badge.className = `status status-${toCssName(shipment.status)}`;
  badge.textContent = shipment.status;

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(
    createRowButton("Update", shipment, openUpdateDialog),
    createRowButton("Edit", shipment, openEditDialog),
    createRowButton("Delete", shipment, openDeleteDialog, "button-danger-outline"),
  );

  row.append(
    createCell(shipment.trackingNumber),
    createCell(badge),
    createCell(shipment.origin),
    createCell(shipment.destination),
    createCell(formatDate(shipment.estimatedDelivery)),
    createCell(actions),
  );
  return row;
}

function createRowButton(label, shipment, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button-secondary ${extraClass}`.trim();
  button.textContent = label;
  button.setAttribute("aria-label", `${label} ${shipment.trackingNumber}`);
  button.addEventListener("click", () => onClick(shipment));
  return button;
}

function createCell(content) {
  const cell = document.createElement("td");
  cell.append(content);
  return cell;
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

function updatePager({ page, totalPages, total }) {
  pager.hidden = totalPages <= 1;
  pagerInfo.textContent = `Page ${page} of ${totalPages} · ${total} shipments`;
  previousPage.disabled = page <= 1;
  nextPage.disabled = page >= totalPages;
}

previousPage.addEventListener("click", () => {
  currentPage -= 1;
  loadShipments();
});

nextPage.addEventListener("click", () => {
  currentPage += 1;
  loadShipments();
});

search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage = 1;
    loadShipments();
  }, SEARCH_DELAY_MS);
});

// --- Dialogs --------------------------------------------------------------

function openDialog(dialog, form) {
  form.reset();
  hideFormError(form);
  dialog.showModal();
}

document.querySelector("#new-shipment").addEventListener("click", () => openDialog(createDialog, createForm));

function openEditDialog(shipment) {
  selectedTrackingNumber = shipment.trackingNumber;
  openDialog(editDialog, editForm);
  editTitle.textContent = `Edit ${shipment.trackingNumber}`;
  editForm.elements.origin.value = shipment.origin;
  editForm.elements.destination.value = shipment.destination;
  editForm.elements.estimatedDelivery.value = shipment.estimatedDelivery;
}

function openUpdateDialog(shipment) {
  selectedTrackingNumber = shipment.trackingNumber;
  openDialog(updateDialog, updateForm);
  updateTitle.textContent = `Update ${shipment.trackingNumber}`;
  statusSelect.value = shipment.status;
}

function openDeleteDialog(shipment) {
  selectedTrackingNumber = shipment.trackingNumber;
  openDialog(deleteDialog, deleteForm);
  deleteTitle.textContent = `Delete ${shipment.trackingNumber}?`;
}

for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}

function selectedUrl() {
  return `${SHIPMENTS_URL}/${encodeURIComponent(selectedTrackingNumber)}`;
}

createForm.addEventListener("submit", (event) => {
  // New shipments appear first, so go back to the first page to show them.
  submitDialog(event, createDialog, "POST", SHIPMENTS_URL, (data) => {
    currentPage = 1;
    return `Created ${data.shipment.trackingNumber}.`;
  });
});

editForm.addEventListener("submit", (event) => {
  submitDialog(event, editDialog, "PUT", selectedUrl(), (data) => `Saved ${data.shipment.trackingNumber}.`);
});

updateForm.addEventListener("submit", (event) => {
  submitDialog(event, updateDialog, "POST", `${selectedUrl()}/events`, (data) => `Updated ${data.shipment.trackingNumber}.`);
});

deleteForm.addEventListener("submit", (event) => {
  const deleted = selectedTrackingNumber;
  submitDialog(event, deleteDialog, "DELETE", selectedUrl(), () => `Deleted ${deleted}.`);
});

async function submitDialog(event, dialog, method, url, successMessage) {
  event.preventDefault();

  const form = event.target;
  const button = form.querySelector("button[type=submit]");
  hideFormError(form);
  button.disabled = true;

  try {
    const options = { method };
    if (method !== "DELETE") {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(Object.fromEntries(new FormData(form)));
    }

    const response = await fetch(url, options);
    const data = response.status === 204 ? null : await response.json();

    if (!response.ok) {
      showFormError(form, data.error);
      return;
    }

    dialog.close();
    showMessage(successMessage(data), "success");
    await loadShipments();
  } catch {
    showFormError(form, "Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
  }
}

function showFormError(form, message) {
  const box = form.querySelector(".form-error");
  box.textContent = message;
  box.hidden = false;
}

function hideFormError(form) {
  form.querySelector(".form-error").hidden = true;
}

function showMessage(text, type) {
  const message = document.createElement("p");
  message.className = `message message-${type}`;
  message.textContent = text;
  messageBox.replaceChildren(message);
}

loadShipments();
