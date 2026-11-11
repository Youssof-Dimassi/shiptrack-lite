// The website's pages.
//
// Every page shares the same <head>, header, and footer, which live in ONE
// file: src/pages/_layout.html. Each page file (src/pages/login.html, ...)
// only holds what's different about that page, plus a few settings at the top:
//
//   <!-- title: Log in -->              shown in the browser tab
//   <!-- scripts: account.js -->        the page's own browser scripts
//   <!-- layout: wide -->               optional: use the wider admin width
//   <!-- description: ... -->           optional: the summary search engines show
//
// The server puts the two together when someone opens the page.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { isProduction } from "../config.js";

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pages");

// The list of pages is fixed when the server starts. Only these names can ever
// be opened, so an address like /../package.json can't reach other files.
const pageNames = new Set(
  fs.readdirSync(pagesDir)
    .filter((file) => file.endsWith(".html") && !file.startsWith("_"))
    .map((file) => file.slice(0, -".html".length)),
);

// In production, pages are built once and kept. While developing they're
// rebuilt on every visit, so changes show up after a refresh.
const builtPages = new Map();

const DEFAULT_DESCRIPTION = "Track your shipments, see every stop they make, and get an email when they move.";

export const pagesRouter = Router();

pagesRouter.get("/", (req, res) => sendPage(res, "index"));

// Both /login and /login.html work.
pagesRouter.get("/:page", (req, res, next) => {
  const name = req.params.page.replace(/\.html$/, "");
  if (!pageNames.has(name)) return next(); // not a page: maybe a file like style.css
  sendPage(res, name);
});

function sendPage(res, name) {
  if (!builtPages.has(name) || !isProduction) builtPages.set(name, buildPage(name));
  res.type("html").send(builtPages.get(name));
}

export function buildPage(name) {
  const layout = fs.readFileSync(path.join(pagesDir, "_layout.html"), "utf8");
  const page = fs.readFileSync(path.join(pagesDir, `${name}.html`), "utf8");

  // Read the settings lines at the top of the page, then remove them.
  const settings = {};
  const content = page.replace(/^<!-- (\w+): (.*?) -->\r?\n/gm, (line, key, value) => {
    settings[key] = value.trim();
    return "";
  });

  const scripts = (settings.scripts ?? "")
    .split(",")
    .map((script) => script.trim())
    .filter(Boolean)
    .map((script) => `    <script src="/${script}" defer></script>`)
    .join("\n");

  const values = {
    title: escapeHtml(settings.title ? `${settings.title} · ShipTrack Lite` : "ShipTrack Lite"),
    description: escapeHtml(settings.description ?? DEFAULT_DESCRIPTION),
    scripts,
    container: settings.layout === "wide" ? "container admin-container" : "container",
    content: content.trim(),
  };

  // A misspelled placeholder like {{titel}} stops with a clear error, instead
  // of quietly putting "undefined" on every page.
  return layout.replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
    if (!(key in values)) throw new Error(`Unknown placeholder ${placeholder} in src/pages/_layout.html`);
    return values[key];
  });
}

// Titles and descriptions go inside HTML attributes, so characters like " and
// < are written in their safe HTML form.
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
