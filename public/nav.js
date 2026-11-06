// Navigation bar: show "Log in" or "Hi, <name> · Log out".
//
// Loaded on every page. It asks the server "who am I?" (GET /api/auth/me).
// The browser sends the login cookie automatically with that request.

const accountNav = document.querySelector("#account-nav");

async function updateAccountNav() {
  if (!accountNav) return;

  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return; // 401 = not logged in: keep the "Log in" link

    const { user } = await response.json();

    const greeting = document.createElement("span");
    greeting.className = "nav-greeting";
    greeting.textContent = `Hi, ${user.name}`; // textContent: safe even if the name contains HTML

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "link-button";
    logoutButton.textContent = "Log out";
    logoutButton.addEventListener("click", logOut);

    accountNav.replaceChildren(greeting, logoutButton);
  } catch {
    // Server unreachable: leave the nav as it is.
  }
}

async function logOut() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/"; // back to the home page, now logged out
}

updateAccountNav();
