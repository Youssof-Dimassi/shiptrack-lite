// The "My shipments" page: list, add, and remove saved shipments.

const myLoading = document.querySelector("#my-loading");
const myApp = document.querySelector("#my-app");
const savedList = document.querySelector("#saved-list");
const myEmpty = document.querySelector("#my-empty");
const addForm = document.querySelector("#add-form");
const addInput = document.querySelector("#add-number");
const addError = addForm.querySelector(".form-error");
const addButton = addForm.querySelector("button[type=submit]");

async function loadSavedShipments() {
  let response;
  try {
    response = await fetch("/api/my-shipments");
  } catch {
    myLoading.textContent = "Could not reach the server. Please refresh the page.";
    return false;
  }

  if (response.status === 401) {
    window.location.href = "/login";
    return false;
  }

  if (!response.ok) {
    myLoading.textContent = "Something went wrong. Please refresh the page.";
    return false;
  }

  const { shipments } = await response.json();
  savedList.replaceChildren(...shipments.map(createCard));
  myEmpty.hidden = shipments.length > 0;
  myLoading.hidden = true;
  myApp.hidden = false;
  return true;
}

// Built with textContent, so shipment details always stay plain text.
function createCard(shipment) {
  const card = document.createElement("li");
  card.className = "saved-card";

  const number = document.createElement("a");
  number.className = "saved-number";
  number.href = `/?track=${encodeURIComponent(shipment.trackingNumber)}`;
  number.textContent = shipment.trackingNumber;

  const badge = createText("span", shipment.status);
  badge.className = `status status-${shipment.status.toLowerCase().replaceAll(" ", "-")}`;

  const top = document.createElement("div");
  top.className = "saved-top";
  top.append(number, badge);

  card.append(top, createText("p", `${shipment.origin} → ${shipment.destination}`));

  const details = [`Estimated delivery ${formatShipmentDate(shipment.estimatedDelivery)}`];
  if (shipment.latestUpdate) {
    details.push(`Latest: ${shipment.latestUpdate.description}, ${shipment.latestUpdate.location}`);
  }
  for (const line of details) {
    const paragraph = createText("p", line);
    paragraph.className = "saved-detail";
    card.append(paragraph);
  }

  const removeButton = createText("button", "Remove");
  removeButton.type = "button";
  removeButton.className = "button-secondary saved-remove";
  removeButton.setAttribute("aria-label", `Remove ${shipment.trackingNumber}`);
  removeButton.addEventListener("click", () => removeShipment(shipment.trackingNumber, removeButton));
  card.append(removeButton);

  return card;
}

function createText(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function formatShipmentDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addError.hidden = true;
  addButton.disabled = true;

  try {
    const response = await fetch("/api/my-shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingNumber: addInput.value }),
    });

    if (response.ok) {
      addForm.reset();
      await loadSavedShipments();
    } else {
      showAddError((await response.json()).error);
    }
  } catch {
    showAddError("Could not reach the server. Please try again.");
  } finally {
    addButton.disabled = false;
  }
});

async function removeShipment(trackingNumber, button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/my-shipments/${encodeURIComponent(trackingNumber)}`, { method: "DELETE" });
    if (response.ok || response.status === 404) {
      await loadSavedShipments();
      return;
    }
    showAddError("Could not remove that shipment. Please try again.");
  } catch {
    showAddError("Could not reach the server. Please try again.");
  }
  button.disabled = false;
}

function showAddError(message) {
  addError.textContent = message;
  addError.hidden = false;
}

// --- Reminder to confirm the email address ----------------------------------

const confirmBanner = document.querySelector("#confirm-banner");
const confirmBannerText = document.querySelector("#confirm-banner-text");
const resendButton = document.querySelector("#resend-confirmation");

async function showConfirmReminder() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return;
    confirmBanner.hidden = (await response.json()).user.emailConfirmed;
  } catch {
    // It's only a reminder, so it's fine to skip it.
  }
}

resendButton.addEventListener("click", async () => {
  resendButton.disabled = true;
  try {
    const response = await fetch("/api/auth/resend-confirmation", { method: "POST" });
    const data = await response.json();
    confirmBannerText.textContent = data.message ?? data.error;
  } catch {
    confirmBannerText.textContent = "Could not reach the server. Please try again.";
  } finally {
    resendButton.disabled = false;
  }
});

loadSavedShipments();
showConfirmReminder();
