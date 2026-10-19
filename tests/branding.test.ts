import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandError, adminBrandVars, brandOf, brandedTheme, checkBrand, emailBrandOf, imageRef } from "../lib/branding/brand.ts";
import { DEFAULT_THEME, checkTheme } from "../lib/forms/theme.ts";
import { renderTemplate } from "../lib/automation/template.ts";

// White-label branding per tenant. Fake data only.

test("brand settings are checked", () => {
  const ok = checkBrand({ name: "  Acme  Tax ", tagline: "We file.", support_email: "Help@Acme.test", app_host: "https://App.Acme.test/", primary_color: "#ABC", sidebar_color: "#0b1220", logo_url: "https://cdn.acme.test/logo.png", white_label_admin: "on" });
  assert.equal(ok.name, "Acme Tax");
  assert.equal(ok.support_email, "help@acme.test");
  assert.equal(ok.app_host, "app.acme.test");
  assert.equal(ok.primary_color, "#aabbcc");
  assert.equal(ok.white_label_admin, true);
  assert.equal(ok.show_powered_by, false, "powered-by is off unless chosen");
  assert.equal(ok.mark_url, null);
  assert.throws(() => checkBrand({ name: "A" }), BrandError);
  assert.throws(() => checkBrand({ name: "Acme", primary_color: "blue" }), /colour/);
  assert.throws(() => checkBrand({ name: "Acme", support_email: "nope" }), /support email/);
  assert.throws(() => checkBrand({ name: "Acme", app_host: "not a host" }), /sign-in address/);
  assert.throws(() => checkBrand({ name: "Acme", logo_url: "javascript:alert(1)" }), BrandError);
  assert.throws(() => checkBrand({ name: "Acme", logo_url: "http://insecure.test/x.png" }), BrandError);
  assert.throws(() => checkBrand({ name: "Acme", logo_url: "//evil.test/x.png" }), BrandError);
  assert.equal(imageRef("/brand/logo.png", "x"), "/brand/logo.png");
});

test("a tenant without a brand falls back to its firm name, with the platform's colours", () => {
  const b = brandOf(null, " Acme Tax ");
  assert.equal(b.name, "Acme Tax");
  assert.equal(b.custom, false);
  assert.equal(b.whiteLabelAdmin, false);
  assert.equal(b.showPoweredBy, false);
  assert.equal(brandOf(null, null).name, "Your account");
});

test("customer emails carry the tenant's name, logo and colour, and the default look is the platform's", () => {
  const def = renderTemplate("Hello", "Body text", {}, { supportEmail: "support@verexahq.com" });
  assert.match(def.html, /VEREXA HQ/);
  assert.match(def.html, /background:#111111/);
  assert.doesNotMatch(def.html, /Powered by/);
  const brand = emailBrandOf(brandOf({ name: "Acme Tax", sidebar_color: "#0b1220", logo_url: "https://cdn.acme.test/logo.png", support_email: "help@acme.test", show_powered_by: false }));
  const mine = renderTemplate("Hello", "Body text", {}, { ...brand, supportEmail: brand.supportEmail! });
  assert.match(mine.html, /<img src="https:\/\/cdn\.acme\.test\/logo\.png" alt="Acme Tax"/);
  assert.match(mine.html, /background:#0b1220/);
  assert.match(mine.html, /help@acme\.test/);
  assert.doesNotMatch(mine.html, /Monarch|Verexa/);
  assert.doesNotMatch(mine.text, /Monarch|Verexa/);
  const noLogo = renderTemplate("Hi", "Body", {}, { ...emailBrandOf(brandOf({ name: "Acme Tax", show_powered_by: true })), supportEmail: "help@acme.test" });
  assert.match(noLogo.html, />ACME TAX</);
  assert.match(noLogo.html, /Powered by Verexa HQ/);
  assert.match(noLogo.text, /Powered by Verexa HQ/);
  const relativeLogo = emailBrandOf(brandOf({ name: "Acme", logo_url: "/brand/logo.png" }));
  assert.equal(relativeLogo.logoUrl, null, "emails need an https logo");
});

test("a form's own theme wins; the brand fills what it leaves alone", () => {
  const brand = brandOf({ name: "Acme", primary_color: "#112233", sidebar_color: "#0b1220", logo_url: "https://cdn.acme.test/logo.png" });
  const plain = brandedTheme(DEFAULT_THEME, brand);
  assert.equal(plain.header, "#0b1220");
  assert.equal(plain.button, "#112233");
  assert.equal(plain.logo_url, "https://cdn.acme.test/logo.png");
  const own = brandedTheme(checkTheme({ header: "#ff0000", button: "#00ff00" }), brand);
  assert.equal(own.header, "#ff0000");
  assert.equal(own.button, "#00ff00");
  assert.equal(brandedTheme(DEFAULT_THEME, brandOf(null, "Acme")), DEFAULT_THEME, "no saved brand: the form is untouched");
  assert.equal(brandedTheme(DEFAULT_THEME, null), DEFAULT_THEME);
});

test("a white-labelled admin is recoloured with the tenant's colours", () => {
  const vars = adminBrandVars(brandOf({ name: "Acme", primary_color: "#112233", sidebar_color: "#0b1220" }));
  assert.equal(vars["--gold"], "#112233");
  assert.equal(vars["--brand-sidebar"], "#0b1220");
});
