// The site's simple forms: log in, sign up, forgot password, choose a new
// password, contact, and the pages opened from email links (confirm email,
// unsubscribe).
//
// Each page has only one of these, so each part runs only where it's found.

const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const forgotForm = document.querySelector("#forgot-form");
const resetForm = document.querySelector("#reset-form");
const contactForm = document.querySelector("#contact-form");
const linkAction = document.querySelector("#link-action");

if (loginForm) handleForm(loginForm, "/api/auth/login", goHome);
if (registerForm) handleForm(registerForm, "/api/auth/register", goHome);
if (forgotForm) handleForm(forgotForm, "/api/auth/forgot-password", showDone);
if (contactForm) handleForm(contactForm, "/api/contact", showDone);
if (resetForm) setUpResetForm();
if (linkAction) runLinkAction();

// --- Forms ----------------------------------------------------------------

// Sends the form's fields to the server as JSON. On success, runs onSuccess;
// otherwise shows the server's error message under the form.
function handleForm(form, url, onSuccess, extraData = {}) {
  const errorBox = form.querySelector(".form-error");
  const button = form.querySelector("button[type=submit]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    button.disabled = true;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), ...extraData }),
      });
      const data = await response.json();

      if (response.ok) {
        onSuccess(form, data);
        return;
      }
      showFormError(form, data.error);
    } catch {
      showFormError(form, "Could not reach the server. Please try again.");
    } finally {
      button.disabled = false;
    }
  });
}

function goHome() {
  window.location.href = "/"; // logged in: the cookie is set
}

// Replaces the form with the "done" message, e.g. "Check your email".
function showDone(form, data) {
  const done = document.querySelector("#done");
  form.hidden = true;
  done.querySelector("p").textContent = data.message;
  done.hidden = false;
}

function showFormError(form, message) {
  const errorBox = form.querySelector(".form-error");
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function setUpResetForm() {
  const token = new URLSearchParams(window.location.search).get("token");

  if (token) {
    handleForm(resetForm, "/api/auth/reset-password", showDone, { token });
  } else {
    showFormError(resetForm, "This link is invalid or has expired.");
    resetForm.querySelector("button[type=submit]").disabled = true;
  }
}

// --- Pages opened from email links ----------------------------------------
//
// Opening a link must not change anything, because email security scanners
// open links automatically. The change only happens in this POST request.
// The page says where to send it and what to show, in data-... attributes.

async function runLinkAction() {
  const title = document.querySelector("#link-title");
  const text = document.querySelector("#link-text");
  const { endpoint, successTitle, successNote, errorNote } = linkAction.dataset;
  const token = new URLSearchParams(window.location.search).get("token");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();

    title.textContent = response.ok ? successTitle : "Link not valid";
    text.textContent = response.ok ? joinText(data.message, successNote) : joinText(data.error, errorNote);
  } catch {
    title.textContent = "Something went wrong";
    text.textContent = "Could not reach the server. Please try the link again.";
  }
}

function joinText(...parts) {
  return parts.filter(Boolean).join(" ");
}
