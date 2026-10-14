import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, sentence, steps } from "../lib/wisp/plan.ts";

const BASE = {
  firm_name: "Test Tax LLC", owner_name: "Pat Owner", business_email: "pat@test.example.com", address: "1 Main St", phone: "5550100", tax_software: "TaxSlayer Pro",
  data_locations: "cloud and a locked office NAS", backup_method: "daily encrypted cloud backup", num_users: "5",
  mfa_status: "MFA on all systems", access_policy: "role based", encryption: "Encrypted in transit and at rest",
  physical_security: "locked cabinets", training: "Annual training completed", ir_contact: "Pat Owner", ir_steps: "Contain, assess, notify", review_date: "January 2027",
};
const text = (a: Record<string, string>) => JSON.stringify(buildPlan(a));

test("the plan is written from the answers, in paragraphs under section headings", () => {
  const plan = buildPlan(BASE);
  assert.ok(plan.length >= 10);
  assert.deepEqual(plan.map((s) => s.title).slice(0, 2), ["Purpose and Scope", "Firm Information and Responsibility"]);
  const all = text(BASE);
  for (const v of ["Test Tax LLC", "Pat Owner", "TaxSlayer Pro", "Role based.", "Locked cabinets.", "January 2027", "currently has 5 people"]) assert.ok(all.includes(v), v);
  assert.ok(plan.find((s) => s.title === "Incident Response Plan")!.blocks.some((b) => b.kind === "h" && b.text === "4. Notify"));
  assert.match(all, /no later than 30 days after discovery/);
});

test("a missing safeguard is stated plainly and listed as a corrective action, never as done", () => {
  const gaps = { ...BASE, mfa_status: "No MFA yet — will implement", encryption: "Not yet encrypted", training: "No formal training yet" };
  const all = text(gaps);
  assert.match(all, /not yet in place and will be implemented/);
  assert.match(all, /not yet encrypted/);
  assert.match(all, /Corrective actions identified/);
  assert.doesNotMatch(all, /MFA\) is in use on all systems/);
  assert.match(text(BASE), /Current position/);
});

test("nothing is invented for an answer that wasn't given", () => {
  const all = text({ ...BASE, ein: "", data_locations: "", backup_method: "" });
  assert.doesNotMatch(all, /"EIN"/);
  assert.doesNotMatch(all, /taxpayer data is stored in the following places/);
  assert.doesNotMatch(all, /backup method is/);
});

test("typed answers become sentences and numbered steps", () => {
  assert.equal(sentence(" locked cabinets "), "Locked cabinets.");
  assert.equal(sentence("Done."), "Done.");
  assert.deepEqual(steps("1. Contain… 2. Assess 3. Notify IRS"), ["Contain…", "Assess.", "Notify IRS."]);
  assert.deepEqual(steps("Contain\nAssess"), ["Contain.", "Assess."]);
  assert.equal(steps("Contain, assess, notify"), null);
});
