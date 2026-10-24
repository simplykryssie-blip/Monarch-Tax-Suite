import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PLATFORM } from "../lib/platform-brand.ts";

// Platform branding is Verexa HQ; each tenant keeps its own brand for what its customers see.

test("the platform is Verexa HQ and its brand files exist", () => {
  assert.equal(PLATFORM.name, "Verexa HQ");
  for (const f of [PLATFORM.logo, PLATFORM.logoFull, PLATFORM.mark]) assert.ok(existsSync(`public${f}`), f);
  for (const f of [PLATFORM.favicon, PLATFORM.appleIcon, PLATFORM.ogImage.url]) assert.ok(existsSync(`public${f}`), f);
});

test("the workspace colors are Verexa's, with none of Monarch's gold left", () => {
  const css = readFileSync("app/theme.css", "utf8") + readFileSync("app/globals.css", "utf8");
  assert.match(css, /Verexa HQ design system/);
  for (const gold of ["#c8a24a", "#b8902f", "#8a6420", "#bd974d", "#f4e3a6", "rgba(200,162,74", "#c9a227"]) assert.equal(css.toLowerCase().includes(gold), false, gold);
  assert.match(css, /\.cl-tabs a\.is-on\{[^}]*border-bottom-color:#236fcd/);
});
