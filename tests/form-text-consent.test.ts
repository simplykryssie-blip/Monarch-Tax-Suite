import assert from "node:assert/strict";
import test from "node:test";
import { emptyDefinition, newField } from "../lib/forms/definition.ts";
import { checkSettings, DEFAULT_SETTINGS, readSettings, respondentKeys, showsTextConsent } from "../lib/forms/settings.ts";

const def = () => {
  const d = emptyDefinition();
  const taken = new Set<string>();
  for (const t of ["short_text", "email", "phone"] as const) {
    const f = newField(t, taken);
    taken.add(f.key);
    d.pages[0].sections[0].fields.push(f);
  }
  return d;
};

test("the text box shows only on a Forms-to-Leads form that asks for a phone number", () => {
  const d = def();
  assert.equal(DEFAULT_SETTINGS.text_consent_box, true);
  assert.equal(showsTextConsent({ ...DEFAULT_SETTINGS, add_to_leads: false }, d), false);
  assert.equal(showsTextConsent({ ...DEFAULT_SETTINGS, add_to_leads: true }, d), true);
  assert.equal(showsTextConsent({ ...DEFAULT_SETTINGS, add_to_leads: true, text_consent_box: false }, d), false);
  const noPhone = emptyDefinition();
  noPhone.pages[0].sections[0].fields.push(newField("email", new Set()));
  assert.equal(showsTextConsent({ ...DEFAULT_SETTINGS, add_to_leads: true }, noPhone), false);
});

test("the phone question is picked automatically and can be chosen; forms saved before the setting existed keep the box on", () => {
  const d = def();
  const phone = respondentKeys(DEFAULT_SETTINGS, d).phone_key;
  assert.ok(phone);
  assert.equal(readSettings({ add_to_leads: true }).text_consent_box, true);
  const saved = checkSettings({ add_to_leads: "on", text_consent_box: "on", respondent: { phone_key: phone } }, d, []);
  assert.equal(saved.respondent.phone_key, phone);
  assert.equal(saved.text_consent_box, true);
  assert.equal(checkSettings({ add_to_leads: "on" }, d, []).text_consent_box, false);
  assert.throws(() => checkSettings({ respondent: { phone_key: respondentKeys(DEFAULT_SETTINGS, d).email_key } }, d, []), /phone/i);
});
