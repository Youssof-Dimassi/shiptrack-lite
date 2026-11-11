// Account settings: name, email address, password, and deleting the account.

const settingsLoading = document.querySelector("#settings-loading");
const settingsApp = document.querySelector("#settings-app");
const nameForm = document.querySelector("#name-form");
const emailForm = document.querySelector("#email-form");
const passwordForm = document.querySelector("#password-form");
const deleteForm = document.querySelector("#delete-form");
const deleteStart = document.querySelector("#delete-start");
const currentEmail = document.querySelector("#current-email");
const emailStatus = document.querySelector("#email-status");
const pendingNote = document.querySelector("#pending-email-note");

async function loadAccount() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    showAccount((await response.json()).user);
    settingsLoading.hidden = true;
    settingsApp.hidden = false;
  } catch {
    settingsLoading.textContent = "Could not reach the server. Please refresh the page.";
  }
}

// textContent keeps names and addresses as plain text.
function showAccount(user) {
  nameForm.elements.name.value = user.name;
  currentEmail.textContent = user.email;
  emailStatus.textContent = user.emailConfirmed ? "Confirmed" : "Not confirmed";
  emailStatus.className = `status ${user.emailConfirmed ? "status-delivered" : "status-pending"}`;
  pendingNote.textContent = user.pendingEmail
    ? `Waiting for you to confirm ${user.pendingEmail}. Open the link we sent to that address.`
    : "";
  pendingNote.hidden = !user.pendingEmail;
}

// Sends one of the forms. Returns the server's answer, or null after showing
// the error under the form.
async function sendSettings(form, method, url, body) {
  const errorBox = form.querySelector(".form-error");
  const successBox = form.querySelector(".form-success");
  const button = form.querySelector("button[type=submit]");
  errorBox.hidden = true;
  if (successBox) successBox.hidden = true;
  button.disabled = true;

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = response.status === 204 ? {} : await response.json();
    if (response.ok) return data;
    showBox(errorBox, data.error);
  } catch {
    showBox(errorBox, "Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
  }
  return null;
}

function showBox(box, text) {
  box.textContent = text;
  box.hidden = false;
}

nameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await sendSettings(nameForm, "PUT", "/api/account/profile", { name: nameForm.elements.name.value });
  if (!data) return;
  showAccount(data.user);
  showBox(nameForm.querySelector(".form-success"), "Your name has been saved.");
  const greeting = document.querySelector(".nav-greeting");
  if (greeting) greeting.textContent = `Hi, ${data.user.name}`;
});

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(emailForm));
  const data = await sendSettings(emailForm, "PUT", "/api/account/email", body);
  if (!data) return;
  emailForm.reset();
  showBox(emailForm.querySelector(".form-success"), data.message);
  pendingNote.textContent = `Waiting for you to confirm ${body.email.trim().toLowerCase()}. Open the link we sent to that address.`;
  pendingNote.hidden = false;
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await sendSettings(passwordForm, "PUT", "/api/account/password", Object.fromEntries(new FormData(passwordForm)));
  if (!data) return;
  passwordForm.reset();
  showBox(passwordForm.querySelector(".form-success"), data.message);
});

// Deleting takes two steps: open the confirmation, then enter the password.
deleteStart.addEventListener("click", () => {
  deleteStart.hidden = true;
  deleteForm.hidden = false;
  deleteForm.elements.password.focus();
});

document.querySelector("#delete-cancel").addEventListener("click", () => {
  deleteForm.reset();
  deleteForm.hidden = true;
  deleteStart.hidden = false;
});

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await sendSettings(deleteForm, "DELETE", "/api/account", { password: deleteForm.elements.password.value });
  if (data) window.location.href = "/";
});

loadAccount();
