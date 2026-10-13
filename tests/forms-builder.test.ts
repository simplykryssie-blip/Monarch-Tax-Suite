import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkDefinition, DefinitionError, keyFromLabel, newField, type Field, type FormDefinition } from "../lib/forms/definition.ts";
import { evaluate, neighbours } from "../lib/forms/logic.ts";
import { checkAnswers, checkAnswer } from "../lib/forms/answers.ts";
import { checkSettings } from "../lib/forms/settings.ts";

// Phase 2 Step 1, Piece 2: form definitions, show/hide and skip logic, and the server's checks of each answer.

const f = (id: string, type: Field["type"], key: string, extra: Partial<Field> = {}): Field => ({ id, type, key, label: key.replace(/_/g, " "), required: false, width: "full", ...extra });

/** A three-page onboarding-style form. Page 2 is skipped for PTIN holders; the EFIN question shows only for EROs. */
export function sampleDefinition(): FormDefinition {
  return {
    version: 1,
    pages: [
      { id: "page1aaaa", title: "You", skips: [{ id: "rskipaaaa", match: "all", conditions: [{ field: "fltypeaaa", op: "equals", value: "PTIN holder" }], goto: "page3aaaa" }], sections: [{ id: "sect1aaaa", title: "About you", fields: [
        f("fnameaaaa", "short_text", "full_name", { required: true }),
        f("femailaaa", "email", "email", { required: true }),
        f("fltypeaaa", "radio", "filer_type", { required: true, options: ["ERO", "PTIN holder"] }),
        f("fefinaaaa", "short_text", "efin", { required: true, format: "efin", sensitive: true }),
      ] }] },
      { id: "page2aaaa", title: "Office", skips: [], sections: [{ id: "sect2aaaa", title: "Office", fields: [
        f("fbizaaaaa", "short_text", "business_name", { required: true }),
        f("faddraaaa", "address", "office_address", { required: true, line2: true }),
      ] }] },
      { id: "page3aaaa", title: "Documents", skips: [], sections: [{ id: "sect3aaaa", title: "Uploads", fields: [
        f("fptinaaaa", "short_text", "ptin", { format: "ptin", sensitive: true }),
        f("fidaaaaaa", "file", "photo_id", { required: true, fileTypes: ["pdf", "jpg", "png"], maxFiles: 2 }),
        f("fsigaaaaa", "signature", "signature", { required: true }),
      ] }] },
    ],
    rules: [{ id: "rshowefin", target: "fefinaaaa", action: "show", match: "all", conditions: [{ field: "fltypeaaa", op: "equals", value: "ERO" }] }],
  };
}

describe("form definitions", () => {
  test("a valid definition is accepted and keeps its logic", () => {
    const def = checkDefinition(sampleDefinition());
    assert.equal(def.pages.length, 3);
    assert.equal(def.rules.length, 1);
    assert.equal(def.pages[0].skips[0].goto, "page3aaaa");
    assert.equal(def.pages[0].sections[0].fields[3].sensitive, true);
  });

  test("broken definitions are refused with the reason", () => {
    const dupKey = sampleDefinition();
    dupKey.pages[1].sections[0].fields[0].key = "email";
    assert.throws(() => checkDefinition(dupKey), /Two fields use the key "email"/);

    const forwardRule = sampleDefinition();
    forwardRule.rules[0] = { id: "rbadaaaaa", target: "fnameaaaa", action: "show", match: "all", conditions: [{ field: "fltypeaaa", op: "equals", value: "ERO" }] };
    assert.throws(() => checkDefinition(forwardRule), /only test fields that appear earlier/);

    const backSkip = sampleDefinition();
    backSkip.pages[2].skips = [{ id: "rbackaaaa", match: "all", conditions: [{ field: "fnameaaaa", op: "answered" }], goto: "page1aaaa" }];
    assert.throws(() => checkDefinition(backSkip), /must jump forward/);

    const gone = sampleDefinition();
    gone.pages[0].skips[0].goto = "pagegone1";
    assert.throws(() => checkDefinition(gone), /deleted/);

    const badOption = sampleDefinition();
    badOption.rules[0].conditions[0].value = "Accountant";
    assert.throws(() => checkDefinition(badOption), /not one of the options/);

    const twoSigs = sampleDefinition();
    twoSigs.pages[1].sections[0].fields.push(f("fsig2aaaa", "signature", "signature_2"));
    assert.throws(() => checkDefinition(twoSigs), /one signature field/);

    const sameOption = sampleDefinition();
    sameOption.pages[0].sections[0].fields[2].options = ["ERO", "ERO"];
    assert.throws(() => checkDefinition(sameOption), (e) => e instanceof DefinitionError && e.target === "fltypeaaa");
  });

  test("keys come from labels and stay unique", () => {
    const taken = new Set(["business_name"]);
    assert.equal(keyFromLabel("Business name", taken), "business_name_2");
    assert.equal(keyFromLabel("1099 count", new Set()), "field_1099_count");
    assert.equal(keyFromLabel("Número de teléfono", new Set()), "numero_de_telefono");
    assert.equal(newField("file", new Set()).maxFiles, 1);
  });
});

describe("show/hide and skip logic", () => {
  const def = checkDefinition(sampleDefinition());
  test("an ERO sees the EFIN question and every page", () => {
    const s = evaluate(def, { filer_type: "ERO" });
    assert.deepEqual(s.path, ["page1aaaa", "page2aaaa", "page3aaaa"]);
    assert.ok(s.visible.has("fefinaaaa"));
  });
  test("a PTIN holder skips the office page and never sees the EFIN question", () => {
    const s = evaluate(def, { filer_type: "PTIN holder", efin: "123456" });
    assert.deepEqual(s.path, ["page1aaaa", "page3aaaa"]);
    assert.ok(!s.visible.has("fefinaaaa"));
    assert.ok(!s.visible.has("fbizaaaaa"));
    assert.deepEqual(neighbours(def, { filer_type: "PTIN holder" }, "page1aaaa"), { prev: null, next: "page3aaaa", last: false });
  });
  test("a hidden question counts as unanswered for later rules", () => {
    const d = sampleDefinition();
    d.rules.push({ id: "rshowbiz1", target: "sect2aaaa", action: "hide", match: "all", conditions: [{ field: "fefinaaaa", op: "answered" }] });
    const def2 = checkDefinition(d);
    // The EFIN was typed, but the question is hidden for a PTIN holder... and they skip the page anyway; for an ERO it hides the office section.
    assert.ok(!evaluate(def2, { filer_type: "ERO", efin: "123456" }).visible.has("fbizaaaaa"));
    assert.ok(evaluate(def2, { filer_type: "ERO" }).visible.has("fbizaaaaa"));
  });
});

describe("the server's answer checks", () => {
  const today = "2026-10-13";
  test("each question type rejects bad input and cleans good input", () => {
    const one = (field: Field, raw: Parameters<typeof checkAnswer>[1]) => checkAnswer(field, raw, today);
    assert.match(one(f("x1aaaaaaa", "email", "e"), "not-an-email").error!, /valid email/);
    assert.equal(one(f("x1aaaaaaa", "email", "e"), " Ana@Example.COM ").value, "ana@example.com");
    assert.equal(one(f("x2aaaaaaa", "phone", "p", { phoneFormat: "us" }), "1 (555) 010-2030").value, "(555) 010-2030");
    assert.match(one(f("x2aaaaaaa", "phone", "p", { phoneFormat: "us" }), "555-0102").error!, /10-digit/);
    assert.equal(one(f("x3aaaaaaa", "phone", "p", { phoneFormat: "intl" }), "+44 20 7946 0000").value, "+442079460000");
    assert.match(one(f("x4aaaaaaa", "number", "n", { min: 1, max: 10 }), "11").error!, /at most 10/);
    assert.match(one(f("x4aaaaaaa", "number", "n", { decimals: false }), "2.5").error!, /whole number/);
    assert.match(one(f("x5aaaaaaa", "date", "d", { dateMax: { kind: "relative", days: 0 } }), "2026-10-14").error!, /can't be after October 13, 2026/);
    assert.match(one(f("x5aaaaaaa", "date", "d"), "2026-02-30").error!, /real date/);
    assert.match(one(f("x6aaaaaaa", "dropdown", "o", { options: ["A", "B"] }), "C").error!, /one of the options/);
    assert.match(one(f("x7aaaaaaa", "checkboxes", "c", { options: ["A", "B", "C"], maxSelected: 2 }), ["A", "B", "C"]).error!, /at most 2/);
    assert.deepEqual(one(f("x7aaaaaaa", "checkboxes", "c", { options: ["A", "B", "C"] }), ["C", "A"]).value, ["A", "C"]);
    assert.equal(one(f("x8aaaaaaa", "short_text", "ein", { format: "ein" }), "12 3456789").value, "12-3456789");
    assert.match(one(f("x8aaaaaaa", "short_text", "efin", { format: "efin" }), "12345").error!, /six digits/);
    assert.equal(one(f("x8aaaaaaa", "short_text", "ptin", { format: "ptin" }), "p01234567").value, "P01234567");
    assert.match(one(f("x9aaaaaaa", "address", "a", { required: true }), { line1: "1 Main St", city: "Lake Charles", state: "Louisiana", zip: "70607" }).error!, /two-letter state/);
    assert.deepEqual(one(f("x9aaaaaaa", "address", "a"), { line1: "1 Main St", city: "Lake Charles", state: "la", zip: "706071234" }).value, { line1: "1 Main St", city: "Lake Charles", state: "LA", zip: "70607-1234" });
    assert.match(one(f("xaaaaaaaa", "short_text", "s", { maxLength: 5 }), "toolong").error!, /at most 5/);
  });

  test("hidden and skipped answers are dropped, and only visible questions are required", () => {
    const def = checkDefinition(sampleDefinition());
    const r = checkAnswers(def, { full_name: "Ana Ruiz", email: "ana@example.com", filer_type: "PTIN holder", efin: "123456", business_name: "Should be dropped", photo_id: ["2f1f7f6a-0000-4000-8000-000000000001"] }, { today, signed: true });
    assert.deepEqual(Object.keys(r.errors), []);
    assert.equal(r.answers.efin, undefined);
    assert.equal(r.answers.business_name, undefined);
    const ero = checkAnswers(def, { full_name: "Ana Ruiz", email: "ana@example.com", filer_type: "ERO" }, { today, signed: false });
    assert.deepEqual(Object.keys(ero.errors).sort(), ["business_name", "efin", "office_address", "photo_id", "signature"]);
  });
});

describe("form settings", () => {
  const def = checkDefinition(sampleDefinition());
  test("firm mapping must point at the right kinds of questions", () => {
    const ok = checkSettings({ respondent: { email_key: "email", name_key: "full_name" }, firm: { enabled: true, relationship: "partner", legal_name_key: "business_name", efin_key: "efin", address_key: "office_address", people: [{ role: "ero", name_key: "full_name", email_key: "email", ptin_key: "ptin" }] } }, def, []);
    assert.equal(ok.firm.people[0].role, "ero");
    assert.equal(ok.create_customer, true);
    assert.equal(ok.confirmation_email, true);
    assert.throws(() => checkSettings({ respondent: { email_key: "email" }, firm: { enabled: true, legal_name_key: "business_name", efin_key: "business_name", people: [{ role: "ero", name_key: "full_name" }] } }, def, []), /checked as EFIN/);
    assert.throws(() => checkSettings({ respondent: { email_key: "email" }, firm: { enabled: true, legal_name_key: "business_name", people: [] } }, def, []), /at least one person/);
    // Without a chosen respondent question, the form's email question is used, so firm records still link to the customer.
    assert.equal(checkSettings({ firm: { enabled: true, legal_name_key: "business_name", people: [{ role: "ero", name_key: "full_name" }] } }, def, []).firm.enabled, true);
    assert.throws(() => checkSettings({ respondent: { email_key: "full_name" } }, def, []), /email question/);
    assert.throws(() => checkSettings({ notify: { recipients: "a@x.test b@x.test c@x.test d@x.test e@x.test f@x.test" } }, def, []), /at most 5/);
    assert.throws(() => checkSettings({ notify: { sender_id: "not-mine" } }, def, ["mine"]), /verified sending/);
  });
});
