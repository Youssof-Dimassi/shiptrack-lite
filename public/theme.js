// Light and dark mode.
//
// This file loads WITHOUT "defer", before the page is drawn. The theme is set
// first, so a dark-mode visitor never sees a white flash on page load.
//
// Which theme is used:
//   1. The visitor's own choice, if they've clicked the toggle
//   2. Otherwise, their device setting (and it follows that setting live)
//
// Everything is wrapped in a function so these variable names can't clash
// with the other scripts on the page.

(() => {
  const STORAGE_KEY = "shiptrack-theme";
  const root = document.documentElement;
  const deviceDark = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Fixed icons written by us, so innerHTML is safe here. Never use it for
  // text that comes from a user or from the server.
  const ICONS = `
    <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>
    </svg>
    <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
    </svg>`;

  let toggleButton = null;

  // Browsers can refuse storage (private windows, strict settings). The toggle
  // should still work for this page when that happens.
  function readSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Nothing to do: the theme just won't be remembered.
    }
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    if (toggleButton) {
      toggleButton.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
    }
  }

  function deviceTheme() {
    return deviceDark.matches ? "dark" : "light";
  }

  function toggleTheme() {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    saveTheme(nextTheme);

    // Older browsers, and people who asked for less motion, get an instant change.
    if (!document.startViewTransition || reducedMotion.matches) {
      applyTheme(nextTheme);
      return;
    }

    // The new theme spreads out in a circle from the button.
    const box = toggleButton.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(() => applyTheme(nextTheme));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }

  function addToggleButton() {
    const navList = document.querySelector(".site-nav ul");
    if (!navList) return;

    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "theme-toggle";
    toggleButton.innerHTML = ICONS;
    toggleButton.addEventListener("click", toggleTheme);

    const item = document.createElement("li");
    item.append(toggleButton);
    navList.append(item);

    applyTheme(root.dataset.theme); // sets the button's label
  }

  applyTheme(readSavedTheme() ?? deviceTheme());

  deviceDark.addEventListener("change", () => {
    if (!readSavedTheme()) applyTheme(deviceTheme());
  });

  document.addEventListener("DOMContentLoaded", addToggleButton);
})();
