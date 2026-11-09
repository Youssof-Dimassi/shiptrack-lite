// The "forgot password" and "choose a new password" pages.

const forgotForm = document.querySelector("#forgot-form");
const resetForm = document.querySelector("#reset-form");
const donePanel = document.querySelector("#done");

if (forgotForm) setUpForm(forgotForm, "/api/auth/forgot-password", () => ({}));

if (resetForm) {
  const token = new URLSearchParams(window.location.search).get("token");

  if (token) {
    setUpForm(resetForm, "/api/auth/reset-password", () => ({ token }));
  } else {
    const error = resetForm.querySelector(".form-error");
    error.textContent = "This link is invalid or has expired.";
    error.hidden = false;
    resetForm.querySelector("button[type=submit]").disabled = true;
  }
}

function setUpForm(form, url, extraData) {
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
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), ...extraData() }),
      });
      const data = await response.json();

      if (response.ok) {
        form.hidden = true;
        donePanel.querySelector("p").textContent = data.message;
        donePanel.hidden = false;
        return;
      }

      errorBox.textContent = data.error;
      errorBox.hidden = false;
    } catch {
      errorBox.textContent = "Could not reach the server. Please try again.";
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}
