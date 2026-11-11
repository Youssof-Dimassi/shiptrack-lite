import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { createClient } from "./helpers.js";

const visitor = createClient();

const PAGES = {
  "/": { title: "ShipTrack Lite", script: "track.js" },
  "/login": { title: "Log in · ShipTrack Lite", script: "account.js" },
  "/register": { title: "Sign up · ShipTrack Lite", script: "account.js" },
  "/forgot-password": { title: "Forgot password · ShipTrack Lite", script: "account.js" },
  "/reset-password": { title: "Choose a new password · ShipTrack Lite", script: "account.js" },
  "/confirm-email": { title: "Confirm your email · ShipTrack Lite", script: "account.js" },
  "/unsubscribe": { title: "Unsubscribe · ShipTrack Lite", script: "account.js" },
  "/my-shipments": { title: "My shipments · ShipTrack Lite", script: "my-shipments.js" },
  "/admin": { title: "Admin · ShipTrack Lite", script: "admin.js" },
};

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

describe("every page", () => {
  for (const [path, { title, script }] of Object.entries(PAGES)) {
    it(`${path} has the shared layout, its own title, and its script`, async () => {
      const { status, text, headers } = await visitor("GET", path);
      assert.equal(status, 200);
      assert.match(headers.get("content-type"), /text\/html/);

      assert.match(text, /^<!DOCTYPE html>/);
      assert.equal(count(text, /<title>/g), 1);
      assert.match(text, new RegExp(`<title>${title}</title>`));
      assert.equal(count(text, /class="site-header"/g), 1);
      assert.equal(count(text, /class="site-footer"/g), 1);
      assert.equal(count(text, /id="account-nav"/g), 1);

      for (const shared of ["theme.js", "nav.js", "style.css", "favicon.svg"]) {
        assert.equal(count(text, new RegExp(`"/${shared}"`, "g")), 1, `${shared} should appear once`);
      }
      assert.match(text, new RegExp(`<script src="/${script}" defer></script>`));
    });

    it(`${path} has no leftover template markers`, async () => {
      const { text } = await visitor("GET", path);
      assert.doesNotMatch(text, /\{\{|\}\}/);
      assert.doesNotMatch(text, /<!-- \w+: /);
    });
  }

  it("only references scripts that exist", async () => {
    for (const path of Object.keys(PAGES)) {
      const { text } = await visitor("GET", path);
      for (const [, source] of text.matchAll(/<script src="\/([^"]+)"/g)) {
        assert.equal((await visitor("GET", `/${source}`)).status, 200, `${path} loads missing /${source}`);
      }
    }
  });

  it("uses the wide layout only on the admin page", async () => {
    assert.match((await visitor("GET", "/admin")).text, /class="container admin-container header-inner"/);
    assert.match((await visitor("GET", "/login")).text, /class="container header-inner"/);
  });
});

describe("page addresses", () => {
  for (const [path, title] of [["/login.html", "Log in"], ["/index", "ShipTrack Lite"], ["/index.html", "ShipTrack Lite"]]) {
    it(`${path} works too`, async () => {
      const response = await visitor("GET", path);
      assert.equal(response.status, 200);
      assert.match(response.text, new RegExp(`<title>${title}`));
    });
  }

  for (const path of ["/_layout", "/_layout.html", "/pages/login.html", "/src/pages/login.html", "/login.htm", "/LOGIN", "/..%2Fpackage.json"]) {
    it(`doesn't serve ${path}`, async () => {
      assert.equal((await visitor("GET", path)).status, 404);
    });
  }

  it("old page files are gone from public/", () => {
    const leftovers = fs.readdirSync("public").filter((file) => file.endsWith(".html"));
    assert.deepEqual(leftovers, []);
  });
});
