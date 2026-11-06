// Log-in and sign-up forms.
//
// Works for both pages: login.html has #login-form, register.html has
// #register-form. The form's data is sent to the server as JSON.

const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

if (loginForm) setUpForm(loginForm, "/api/auth/login");
if (registerForm) setUpForm(registerForm, "/api/auth/register");

function setUpForm(form, url) {
  const errorBox = form.querySelector(".form-error");
  const button = form.querySelector("button[type=submit]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    button.disabled = true;

    // Collect every <input name="..."> into an object:
    // { email: "...", password: "..." }
    const data = Object.fromEntries(new FormData(form));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // tell the server it's JSON
        body: JSON.stringify(data),
      });

      if (response.ok) {
        window.location.href = "/"; // success: the cookie is set, go home
        return;
      }

      const { error } = await response.json();
      showError(error);
    } catch {
      showError("Could not reach the server. Please try again.");
    } finally {
      button.disabled = false;
    }
  });

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
}
