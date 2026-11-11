// The admin dashboard, users, locations, and activity pages.
//
// Each page has one of these sections, so each part runs only where it's found.
// Hiding pages from customers is only a courtesy: the server checks every request.

const ADMIN_API = "/api/admin";
const adminLoading = document.querySelector("#admin-loading");
const adminDenied = document.querySelector("#admin-denied");
const dashboardApp = document.querySelector("#dashboard-app");
const usersApp = document.querySelector("#users-app");
const activityApp = document.querySelector("#activity-app");
const locationsApp = document.querySelector("#locations-app");

if (dashboardApp) loadDashboard();
if (usersApp) setUpUsers();
if (activityApp) setUpActivity();
if (locationsApp) setUpLocations();

// --- Shared helpers -------------------------------------------------------

// Returns the JSON answer, or null if this visitor isn't allowed (and shows why).
async function getAdminJson(url) {
  const response = await fetch(url);
  if (response.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (response.status === 403) {
    adminLoading.hidden = true;
    adminDenied.hidden = false;
    return null;
  }
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  return response.json();
}

function showSection(section) {
  adminLoading.hidden = true;
  section.hidden = false;
}

function showLoadProblem() {
  adminLoading.hidden = false;
  adminLoading.textContent = "Could not load this page. Please refresh.";
}

// Always textContent, so names, emails, and notes stay plain text.
function element(tag, text = "", className = "") {
  const created = document.createElement(tag);
  if (text !== "") created.textContent = text;
  if (className) created.className = className;
  return created;
}

function cell(...content) {
  const td = document.createElement("td");
  td.append(...content);
  return td;
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

// Previous / Next buttons. onChange gets the new page number.
function setUpPager(root, onChange) {
  let page = 1;
  root.querySelector(".pager-previous").addEventListener("click", () => onChange((page -= 1)));
  root.querySelector(".pager-next").addEventListener("click", () => onChange((page += 1)));

  return function update({ page: current, totalPages, total }, word) {
    page = current;
    root.hidden = totalPages <= 1;
    root.querySelector(".pager-info").textContent = `Page ${current} of ${totalPages} · ${plural(total, word)}`;
    root.querySelector(".pager-previous").disabled = current <= 1;
    root.querySelector(".pager-next").disabled = current >= totalPages;
  };
}

// --- Dashboard ------------------------------------------------------------

async function loadDashboard() {
  try {
    const data = await getAdminJson(`${ADMIN_API}/dashboard`);
    if (!data) return;

    for (const value of document.querySelectorAll("[data-total]")) {
      value.textContent = data.totals[value.dataset.total].toLocaleString();
    }
    document.querySelector("#overdue-tile").classList.toggle("stat-tile-alert", data.totals.overdue > 0);
    document.querySelector("#average-delivery").textContent =
      data.averageDeliveryDays === null ? "–" : `${data.averageDeliveryDays} days`;

    drawWeeklyChart(data.startedPerWeek);
    drawStatusBars(data.byStatus, data.totals.shipments);
    showOverdue(data.overdueShipments);
    showRecentActivity(data.recentActivity);
    showSection(dashboardApp);
  } catch {
    showLoadProblem();
  }
}

// A bar chart drawn as SVG: one bar per week, a tooltip on hover or keyboard
// focus, and the same numbers in a table for screen readers.
function drawWeeklyChart(weeks) {
  const container = document.querySelector("#weekly-chart");
  const SVG = "http://www.w3.org/2000/svg";
  const width = 640;
  const height = 240;
  const plot = { top: 16, right: 8, bottom: 34, left: 34 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;

  const counts = weeks.map((week) => week.count);
  // A round maximum with a whole-number middle line, never smaller than 4.
  const max = Math.max(4, Math.ceil(Math.max(...counts) / 2) * 2);
  const yFor = (value) => plot.top + plotHeight - (value / max) * plotHeight;

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  const busiest = weeks.reduce((best, week) => (week.count > best.count ? week : best), weeks[0]);
  svg.setAttribute(
    "aria-label",
    `Bar chart of shipments started per week. The busiest week was the week of ${weekLabel(busiest.weekStart)}, with ${plural(busiest.count, "shipment")}.`,
  );

  const add = (tag, attributes, text) => {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    if (text !== undefined) shape.textContent = text;
    svg.append(shape);
    return shape;
  };

  // Light guide lines at 0, half, and the maximum.
  for (const value of [0, max / 2, max]) {
    add("line", { x1: plot.left, x2: width - plot.right, y1: yFor(value), y2: yFor(value), class: "chart-grid" });
    add("text", { x: plot.left - 8, y: yFor(value) + 4, "text-anchor": "end", class: "chart-axis-label" }, value);
  }

  const tooltip = element("div", "", "chart-tooltip");
  tooltip.hidden = true;
  const slot = plotWidth / weeks.length;
  const barWidth = Math.min(44, slot * 0.6);

  weeks.forEach((week, index) => {
    const x = plot.left + index * slot + (slot - barWidth) / 2;
    const y = yFor(week.count);
    const barHeight = plot.top + plotHeight - y;
    const label = weekLabel(week.weekStart);

    let bar = null;
    if (week.count > 0) {
      // Rounded at the top only, flat on the baseline.
      const r = Math.min(4, barHeight, barWidth / 2);
      bar = add("path", {
        class: "chart-bar",
        d: `M${x},${y + barHeight} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${y + barHeight} Z`,
      });
    }

    add("text", { x: x + barWidth / 2, y: height - 12, "text-anchor": "middle", class: "chart-axis-label" }, label);

    // An invisible target the full height of the column, easier to hover than the bar.
    const target = add("rect", {
      x: plot.left + index * slot, y: plot.top, width: slot, height: plotHeight,
      class: "chart-hit", tabindex: "0", "aria-label": `Week of ${label}: ${plural(week.count, "shipment")}`,
    });

    const show = () => {
      const scale = svg.getBoundingClientRect().width / width;
      tooltip.textContent = `Week of ${label}: ${plural(week.count, "shipment")}`;
      tooltip.style.left = `${(x + barWidth / 2) * scale}px`;
      tooltip.style.top = `${Math.min(y, plot.top + plotHeight) * scale}px`;
      tooltip.hidden = false;
      bar?.classList.add("is-active");
    };
    const hide = () => {
      tooltip.hidden = true;
      bar?.classList.remove("is-active");
    };
    target.addEventListener("pointerenter", show);
    target.addEventListener("pointerleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
  });

  container.replaceChildren(svg, tooltip);

  document.querySelector("#weekly-table").replaceChildren(
    ...weeks.map((week) => {
      const row = document.createElement("tr");
      row.append(cell(weekLabel(week.weekStart)), cell(String(week.count)));
      return row;
    }),
  );
}

function weekLabel(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// Each status has its name and count written next to its bar, so the bars
// never depend on color alone.
function drawStatusBars(byStatus, total, list = document.querySelector("#status-bars")) {
  list.replaceChildren(
    ...byStatus.map(({ status, count }) => {
      const dot = element("span", "", `filter-dot dot-${status.toLowerCase().replaceAll(" ", "-")}`);
      const name = element("span", "", "status-bars-label");
      name.append(dot, status);

      const fill = element("span", "", "bar-fill");
      fill.style.width = `${total === 0 ? 0 : (count / total) * 100}%`;
      const track = element("span", "", "bar-track");
      track.append(fill);

      const item = document.createElement("li");
      item.append(name, track, element("span", count.toLocaleString(), "status-bars-count"));
      return item;
    }),
  );
}

function showOverdue(shipments) {
  document.querySelector("#overdue-list").replaceChildren(
    ...shipments.map((shipment) => {
      const item = document.createElement("li");
      item.append(
        element("strong", shipment.trackingNumber),
        element("span", `To ${shipment.destination} · was due ${formatDate(shipment.estimatedDelivery)} · ${shipment.status}`),
      );
      return item;
    }),
  );
  document.querySelector("#overdue-empty").hidden = shipments.length > 0;
}

function showRecentActivity(entries) {
  document.querySelector("#recent-activity").replaceChildren(...entries.map(activityItem));
  document.querySelector("#recent-empty").hidden = entries.length > 0;
}

function activityItem(entry) {
  const item = document.createElement("li");
  item.append(element("strong", entry.summary), element("span", `${entry.actorName} · ${formatDateTime(entry.occurredAt)}`));
  return item;
}

// --- Users ----------------------------------------------------------------

function setUpUsers() {
  const search = document.querySelector("#user-search");
  const rows = document.querySelector("#user-rows");
  const empty = document.querySelector("#no-users");
  const messageBox = document.querySelector("#admin-message");
  let page = 1;
  let latestRequest = 0;
  let searchTimer = null;

  const updatePager = setUpPager(usersApp.querySelector("[data-pager]"), (newPage) => {
    page = newPage;
    load();
  });

  async function load() {
    latestRequest += 1;
    const thisRequest = latestRequest;
    const params = new URLSearchParams({ page });
    if (search.value.trim()) params.set("search", search.value.trim());

    try {
      const data = await getAdminJson(`${ADMIN_API}/users?${params}`);
      if (!data || thisRequest !== latestRequest) return;
      rows.replaceChildren(...data.users.map((user) => userRow(user, data.currentUserId)));
      empty.hidden = data.users.length > 0;
      updatePager(data, "user");
      showSection(usersApp);
    } catch {
      showLoadProblem();
    }
  }

  function userRow(user, currentUserId) {
    const role = element("span", user.role === "admin" ? "Admin" : "Customer", `role-badge role-${user.role}`);

    const actions = element("div", "", "row-actions");
    if (user.id === currentUserId) {
      actions.append(element("span", "You", "admin-note"));
    } else {
      actions.append(user.role === "admin" ? removeAdminButton(user) : makeAdminButton(user));
      if (user.role === "customer") actions.append(deleteUserButton(user));
    }

    const row = document.createElement("tr");
    row.append(
      cell(user.name),
      cell(user.email),
      cell(role),
      cell(user.emailConfirmed ? "Yes" : "No"),
      cell(String(user.savedShipments)),
      cell(formatDate(user.createdAt)),
      cell(actions),
    );
    return row;
  }

  function makeAdminButton(user) {
    return actionButton("Make admin", user, () => askToConfirm({
      title: `Make ${user.email} an admin?`,
      text: "They'll be able to create, edit, and delete shipments, and manage users.",
      confirmLabel: "Make admin",
      run: () => send("PUT", `${ADMIN_API}/users/${user.id}/role`, { role: "admin" }),
      done: () => finished(`${user.email} is now an admin.`),
    }));
  }

  function removeAdminButton(user) {
    return actionButton("Remove admin", user, () => askToConfirm({
      title: `Remove admin access from ${user.email}?`,
      text: "They'll keep their account as a customer.",
      confirmLabel: "Remove admin access",
      danger: true,
      run: () => send("PUT", `${ADMIN_API}/users/${user.id}/role`, { role: "customer" }),
      done: () => finished(`${user.email} is no longer an admin.`),
    }));
  }

  function deleteUserButton(user) {
    return actionButton("Delete", user, () => askToConfirm({
      title: `Delete ${user.email}?`,
      text: "This permanently deletes their account and saved shipments. It can't be undone.",
      confirmLabel: "Delete account",
      danger: true,
      run: () => send("DELETE", `${ADMIN_API}/users/${user.id}`),
      done: () => finished(`Deleted the account of ${user.email}.`),
    }), "button-danger-outline");
  }

  function actionButton(label, user, onClick, extraClass = "") {
    const button = element("button", label, `button-secondary ${extraClass}`.trim());
    button.type = "button";
    button.setAttribute("aria-label", `${label}: ${user.email}`);
    button.addEventListener("click", onClick);
    return button;
  }

  function finished(text) {
    messageBox.replaceChildren(element("p", text, "message message-success"));
    load();
  }

  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 1;
      load();
    }, 250);
  });

  load();
}

// A confirmation dialog shared by every risky action on the page.
const confirmDialog = document.querySelector("#confirm-dialog");
let pendingConfirmation = null;

function askToConfirm({ title, text, confirmLabel, danger = false, run, done }) {
  const button = document.querySelector("#confirm-button");
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-text").textContent = text;
  button.textContent = confirmLabel;
  button.classList.toggle("button-danger", danger);
  confirmDialog.querySelector(".form-error").hidden = true;
  pendingConfirmation = { run, done };
  confirmDialog.showModal();
}

if (confirmDialog) {
  document.querySelector("#confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#confirm-button");
    button.disabled = true;
    const result = await pendingConfirmation.run();
    button.disabled = false;

    if (result.ok) {
      confirmDialog.close();
      pendingConfirmation.done();
    } else {
      const errorBox = confirmDialog.querySelector(".form-error");
      errorBox.textContent = result.error;
      errorBox.hidden = false;
    }
  });

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }
}

async function send(method, url, body) {
  try {
    const options = { method };
    if (body) {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (response.ok) return { ok: true };
    return { ok: false, error: (await response.json()).error };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
}

// --- Activity -------------------------------------------------------------

function setUpActivity() {
  const filter = document.querySelector("#activity-filter");
  const rows = document.querySelector("#activity-rows");
  const empty = document.querySelector("#no-activity");
  let page = 1;
  let latestRequest = 0;

  const updatePager = setUpPager(activityApp.querySelector("[data-pager]"), (newPage) => {
    page = newPage;
    load();
  });

  async function load() {
    latestRequest += 1;
    const thisRequest = latestRequest;
    const params = new URLSearchParams({ page });
    if (filter.value) params.set("category", filter.value);

    try {
      const data = await getAdminJson(`${ADMIN_API}/activity?${params}`);
      if (!data || thisRequest !== latestRequest) return;
      rows.replaceChildren(...data.entries.map(activityRow));
      empty.hidden = data.entries.length > 0;
      updatePager(data, "entry");
      showSection(activityApp);
    } catch {
      showLoadProblem();
    }
  }

  function activityRow(entry) {
    const who = element("div");
    who.append(
      element("strong", entry.actorName),
      element("span", entry.actorDeleted ? `${entry.actorEmail} · account deleted` : entry.actorEmail, "activity-email"),
    );

    const row = document.createElement("tr");
    row.append(cell(formatDateTime(entry.occurredAt)), cell(who), cell(entry.summary));
    return row;
  }

  filter.addEventListener("change", () => {
    page = 1;
    load();
  });

  load();
}

// --- Locations ------------------------------------------------------------

function setUpLocations() {
  const form = document.querySelector("#location-form");
  const input = document.querySelector("#location-search");
  const errorBox = document.querySelector("#location-error");
  const busiest = document.querySelector("#busiest-places");
  const report = document.querySelector("#location-report");
  let latestRequest = 0;

  const MATCH_LABELS = { sentFrom: "Sent from", goingTo: "Going to", lastSeen: "Last seen", passedThrough: "Passed through" };

  async function showBusiestPlaces() {
    try {
      const data = await getAdminJson(`${ADMIN_API}/locations/busiest`);
      if (!data) return;
      document.querySelector("#busiest-list").replaceChildren(
        ...data.places.map(({ place, shipments }) => {
          const button = element("button", "", "place-button");
          button.type = "button";
          button.append(element("span", place), element("span", plural(shipments, "shipment"), "place-count"));
          button.addEventListener("click", () => search(place));
          const item = document.createElement("li");
          item.append(button);
          return item;
        }),
      );
      document.querySelector("#busiest-empty").hidden = data.places.length > 0;
      showSection(locationsApp);
    } catch {
      showLoadProblem();
    }
  }

  async function search(place) {
    input.value = place;
    errorBox.hidden = true;
    latestRequest += 1;
    const thisRequest = latestRequest;

    try {
      const response = await fetch(`${ADMIN_API}/locations?search=${encodeURIComponent(place)}`);
      const data = await response.json();
      if (thisRequest !== latestRequest) return;
      if (!response.ok) {
        errorBox.textContent = data.error;
        errorBox.hidden = false;
        return;
      }
      showReport(data);
      // The address remembers the search, so it can be shared or refreshed.
      history.replaceState(null, "", `?place=${encodeURIComponent(place)}`);
    } catch {
      errorBox.textContent = "Could not reach the server. Please try again.";
      errorBox.hidden = false;
    }
  }

  function showReport(data) {
    document.querySelector("#report-title").textContent =
      `"${data.search}": ${plural(data.counts.connected, "shipment")} connected`;
    for (const value of report.querySelectorAll("[data-count]")) {
      value.textContent = data.counts[value.dataset.count].toLocaleString();
    }
    drawStatusBars(data.byStatus, data.counts.connected, document.querySelector("#location-status-bars"));

    document.querySelector("#location-rows").replaceChildren(
      ...data.shipments.map((shipment) => {
        const badge = element("span", shipment.status, `status status-${shipment.status.toLowerCase().replaceAll(" ", "-")}`);
        const tags = element("div", "", "match-tags");
        for (const [key, label] of Object.entries(MATCH_LABELS)) {
          if (shipment.matches[key]) tags.append(element("span", label, "match-tag"));
        }
        const row = document.createElement("tr");
        row.append(
          cell(shipment.trackingNumber),
          cell(badge),
          cell(shipment.origin),
          cell(shipment.destination),
          cell(shipment.lastLocation ?? "–"),
          cell(tags),
        );
        return row;
      }),
    );

    const listed = data.shipments.length;
    document.querySelector("#location-list-note").textContent =
      listed === 0
        ? "No shipments are connected to this place."
        : listed < data.counts.connected
          ? `Showing the newest ${listed} of ${data.counts.connected.toLocaleString()}.`
          : "";

    busiest.hidden = true;
    report.hidden = false;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    search(input.value.trim());
  });

  // Clearing the search box goes back to the busiest places.
  input.addEventListener("search", () => {
    if (input.value) return;
    report.hidden = true;
    busiest.hidden = false;
    errorBox.hidden = true;
    history.replaceState(null, "", location.pathname);
  });

  showBusiestPlaces();
  const fromAddress = new URLSearchParams(window.location.search).get("place");
  if (fromAddress) search(fromAddress);
}
