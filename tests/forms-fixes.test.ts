import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryFormsRepo } from "./forms-memory.ts";
import { checkDefinition, publicDefinition, inputFields, type Field, type FormDefinition } from "../lib/forms/definition.ts";
import { checkAnswers, draftAnswers, startingAnswers, withLocked } from "../lib/forms/answers.ts";
import { checkSettings, readSettings, DEFAULT_SETTINGS, SettingsError } from "../lib/forms/settings.ts";
import { checkTheme, isThemed, readTheme, sanitizeCss, ThemeError } from "../lib/forms/theme.ts";
import { isPlatformHost } from "../lib/brands.ts";
import { saveInternalValues, type FormDeps } from "../lib/forms/service.ts";

// Forms fixes: side-by-side fields, pre-filled and locked values, staff-only fields, the look of the form.
// Fake data only.

const f = (id: string, type: Field["type"], key: string, extra: Partial<Field> = {}): Field => ({ id, type, key, label: key, required: false, width: "full", ...extra });
const def = (fields: Field[]): FormDefinition => ({ version: 1, pages: [{ id: "page1aaaa", title: "One", skips: [], sections: [{ id: "sect1aaaa", title: "", fields }] }], rules: [] });
const TODAY = "2026-10-15";

describe("side-by-side fields", () => {
  test("keeps half and third widths, and puts display blocks and uploads on a full row", () => {
    const d = checkDefinition(def([
      f("fphoneaaa", "phone", "phone", { width: "half" }), f("femailaaa", "email", "email", { width: "half" }),
      f("fthirdaaa", "short_text", "city", { width: "third" }), f("ftwoaaaaa", "short_text", "other", { width: "two_thirds" }),
      f("ffileaaaa", "file", "id_scan", { width: "half", fileTypes: ["pdf"], maxFiles: 1 }), f("fparaaaaa", "paragraph", "note", { width: "half", label: "", text: "Hi" }),
      f("fbogusaaa", "short_text", "bogus", { width: "huge" as Field["width"] }),
    ]));
    const w = Object.fromEntries(inputFields(d).map((x) => [x.key, x.width]));
    assert.deepEqual(w, { phone: "half", email: "half", city: "third", other: "two_thirds", id_scan: "full", bogus: "full" });
    assert.equal(d.pages[0].sections[0].fields.find((x) => x.type === "paragraph")!.width, "full");
  });
});

describe("pre-filled and locked values", () => {
  const d = checkDefinition(def([
    f("fnameaaaa", "short_text", "office", { defaultValue: "Acme Tax LLC", locked: true }),
    f("fnotesaaa", "long_text", "terms", { defaultValue: "Line one\nLine two", locked: true }),
    f("fstartaaa", "short_text", "city", { defaultValue: "Baton Rouge" }),
    f("femailaaa", "email", "email", { defaultValue: "ignored@example.com", locked: true }),
  ]));

  test("only short and long answers take a value; locked needs one", () => {
    const by = Object.fromEntries(inputFields(d).map((x) => [x.key, x]));
    assert.equal(by.office.locked, true);
    assert.equal(by.terms.defaultValue, "Line one\nLine two");
    assert.equal(by.city.locked, undefined);
    assert.equal(by.email.defaultValue, undefined);
    const noValue = checkDefinition(def([f("fnameaaaa", "short_text", "office", { locked: true })]));
    assert.equal(inputFields(noValue)[0].locked, undefined);
    assert.throws(() => checkDefinition(def([f("fnameaaaa", "short_text", "office", { defaultValue: "x".repeat(30), maxLength: 10 })])), /pre-filled value is longer/);
  });

  test("the form starts with the values, and the server ignores a changed locked answer", () => {
    assert.deepEqual(startingAnswers(d), { office: "Acme Tax LLC", terms: "Line one\nLine two", city: "Baton Rouge" });
    assert.equal(startingAnswers(d, { city: "Shreveport", office: "Hacked" }).city, "Shreveport");
    assert.equal(startingAnswers(d, { office: "Hacked" }).office, "Acme Tax LLC");
    const r = checkAnswers(d, { office: "Hacked", terms: "no", city: "New Orleans", email: "a@example.com" }, { today: TODAY, signed: false });
    assert.deepEqual(r.errors, {});
    assert.equal(r.answers.office, "Acme Tax LLC");
    assert.equal(r.answers.terms, "Line one\nLine two");
    assert.equal(r.answers.city, "New Orleans");
    const missing = checkAnswers(d, {}, { today: TODAY, signed: false });
    assert.equal(missing.answers.office, "Acme Tax LLC", "a locked value is submitted even when the browser sends nothing");
    assert.equal(draftAnswers(d, { office: "Hacked" }).office, "Acme Tax LLC");
  });
});

describe("staff-only fields", () => {
  const d = checkDefinition(def([
    f("fnameaaaa", "short_text", "full_name", { required: true }),
    f("fstaffaaa", "short_text", "internal_note", { internal: true, required: true, width: "half" }),
    f("ffileaaaa", "file", "scan", { internal: true, fileTypes: ["pdf"], maxFiles: 1 }),
  ]));

  test("are never required, and uploads can't be staff-only", () => {
    const by = Object.fromEntries(inputFields(d).map((x) => [x.key, x]));
    assert.equal(by.internal_note.internal, true);
    assert.equal(by.internal_note.required, false);
    assert.equal(by.scan.internal, undefined);
  });

  test("are removed from what the respondent gets, and ignored if sent", () => {
    const pub = publicDefinition(d);
    assert.deepEqual(inputFields(pub).map((x) => x.key), ["full_name", "scan"]);
    const r = checkAnswers(d, { full_name: "Test Person", internal_note: "sneaky", scan: [] }, { today: TODAY, signed: false });
    assert.equal(r.answers.internal_note, undefined);
    assert.equal("internal_note" in withLocked(d, { internal_note: "x" }), false);
    assert.equal("internal_note" in draftAnswers(d, { internal_note: "x" }), false);
  });

  test("rules can't depend on them", () => {
    const bad = def([f("fstaffaaa", "short_text", "internal_note", { internal: true }), f("fnameaaaa", "short_text", "full_name")]);
    bad.rules = [{ id: "rule1aaaa", target: "fnameaaaa", action: "show", match: "all", conditions: [{ field: "fstaffaaa", op: "answered" }] }];
    assert.throws(() => checkDefinition(bad), /staff-only/);
  });

  test("staff save values on a submission; only internal fields, only for that submission, recorded", async () => {
    const repo = new MemoryFormsRepo("00000000-0000-4000-8000-0000000000a1");
    const form = await repo.insertForm({ name: "T", public_id: "abc", draft_definition: d, settings: DEFAULT_SETTINGS, created_by: "u" } as never);
    const version = await repo.insertVersion({ form_id: form.id, version: 1, definition: d, published_by: "u" });
    const sub = await repo.insertSubmission({ id: "11111111-1111-4111-8111-111111111111", form_id: form.id, version_id: version.id, status: "new", number: 1, answers: { full_name: "Test Person" }, started_at: "2026-10-15T00:00:00Z", submitted_at: "2026-10-15T00:00:00Z", is_test: true });
    const deps = { repo, tenantId: "t" } as unknown as FormDeps;
    await saveInternalValues(deps, sub.id, { internal_note: "  Call back Monday ", full_name: "Overwritten", nope: "x" }, "admin");
    assert.deepEqual(await repo.listInternalValues(sub.id), { internal_note: "Call back Monday" });
    assert.equal((await repo.getSubmission(sub.id))!.answers.full_name, "Test Person");
    assert.equal(repo.events.filter((e) => e.type === "internal_saved").length, 1);
    await saveInternalValues(deps, sub.id, { internal_note: "" }, "admin");
    assert.deepEqual(await repo.listInternalValues(sub.id), {});
  });
});

describe("the look of the form", () => {
  test("colours, fonts and images are checked", () => {
    const t = checkTheme({ background: "#FFF", button: "#1a2b3c", font: "serif", logo_url: "https://cdn.example.com/logo.png", custom_css: "" });
    assert.equal(t.background, "#ffffff");
    assert.equal(isThemed(t), true);
    assert.equal(isThemed(readTheme(undefined)), false);
    assert.throws(() => checkTheme({ button: "red" }), ThemeError);
    assert.throws(() => checkTheme({ logo_url: "http://insecure.example.com/x.png" }), ThemeError);
    assert.throws(() => checkTheme({ logo_url: "javascript:alert(1)" }), ThemeError);
    assert.equal(checkTheme({ font: "comic-sans" }).font, "default");
  });

  test("settings keep the look when the main settings are saved without it", () => {
    const theme = checkTheme({ button: "#112233" });
    const stored = readSettings({ ...DEFAULT_SETTINGS, theme });
    assert.equal(stored.theme.button, "#112233");
    const saved = checkSettings({ ...stored, theme: stored.theme }, def([f("fnameaaaa", "short_text", "x")]), []);
    assert.equal(saved.theme.button, "#112233");
    assert.throws(() => checkSettings({ theme: { text: "nope" } }, def([f("fnameaaaa", "short_text", "x")]), []), SettingsError);
  });

  test("custom CSS is scoped to the form and unsafe parts are dropped", () => {
    const css = sanitizeCss(`
      body { background: #faf7f0; color: #222 }
      h1, .monarch-primary { color: #12324f; border-radius: 9px }
      @import url("https://evil.example.com/x.css");
      .a { background: url(javascript:alert(1)) ; color: red }
      .b { background: url("https://cdn.example.com/bg.png"); width: expression(alert(1)) }
      .c { position: fixed; top: 0; color: blue }
      .d { color: \\72 ed }
      @font-face { font-family: X; src: url(https://evil.example.com/f.woff) }
      @media (max-width: 600px) { .e { font-size: 18px } }
      .f { -moz-binding: url(x); color: green }
      </style><script>alert(1)</script>
      .g { color: pink }
    `);
    assert.match(css, /\.mf-themed\{background:#faf7f0;color:#222\}/);
    assert.match(css, /\.mf-themed h1,\.mf-themed \.monarch-primary\{color:#12324f;border-radius:9px\}/);
    assert.match(css, /@media \(max-width: 600px\)\{\.mf-themed \.e\{font-size:18px\}\}/);
    assert.match(css, /\.mf-themed \.a\{color:red\}/);
    assert.match(css, /\.mf-themed \.b\{background:url\("https:\/\/cdn\.example\.com\/bg\.png"\)\}/);
    assert.match(css, /\.mf-themed \.c\{top:0;color:blue\}/);
    assert.match(css, /\.mf-themed \.f\{color:green\}/);
    for (const bad of ["@import", "javascript", "expression", "evil.example", "font-face", "<script", "</style", "fixed", "binding", "\\72"]) assert.ok(!css.includes(bad), `${bad} should be removed`);
    for (const line of css.split("\n")) assert.ok(line.startsWith(".mf-themed") || line.startsWith("@media"), `unscoped rule: ${line}`);
  });
});

describe("hosting addresses", () => {
  test("Vercel hosts are recognised", () => {
    for (const h of ["monarch-tax-suite.vercel.app", "x-git-branch-team.vercel.app", "a.b.vercel.app:443", "foo.vercel.sh"]) assert.equal(isPlatformHost(h), true, h);
    for (const h of ["forms.mkb.test", "monarchtaxsuite.com", "vercel.app.example.com", "localhost:3000", null]) assert.equal(isPlatformHost(h), false, String(h));
  });
});
