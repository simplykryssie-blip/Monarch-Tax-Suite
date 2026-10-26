import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { MemoryFirms, MemoryFormsRepo } from "./forms-memory.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { checkDefinition, DefinitionError, emptyDefinition, newField, type FormDefinition } from "../lib/forms/definition.ts";
import { eachText, FORM_MERGE_KEYS, fillTokens, formMergeValues, mergeDefinition, unknownTokens } from "../lib/forms/merge.ts";
import { checkInvite, createInvite, inviteStatus, markInviteOpened, revokeInvite } from "../lib/forms/invites.ts";
import { afterSubmit } from "../lib/forms/after.ts";
import { createForm, publishForm, publicForm, saveDraft, startStamp, submitForm, type FormDeps } from "../lib/forms/service.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { answerStrings } from "../lib/forms/service.ts";
import type { AutomationDeps } from "../lib/automation/engine.ts";
import type { Submission } from "../lib/forms/types.ts";

// Step 2: details in forms, a personal link per client, the submission tied to the client, and the PDF in their files.

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const who = { ipHash: "abc123", userAgent: "test-browser" };
const client = { id: "11111111-1111-4111-8111-111111111111", full_name: "Jane Q Smith", email: "jane@example.com", archived_at: null };

function definition(): FormDefinition {
  const d = emptyDefinition();
  const taken = new Set<string>();
  const intro = newField("paragraph", taken); intro.text = "Hello {{client_first_name}}, {{firm_name}} needs a few details on {{today}}.";
  const note = newField("short_text", taken); note.label = "Anything to add for {{client_name}}?"; note.key = "note"; note.required = true; note.defaultValue = "{{client_name}}";
  d.pages[0].sections[0].fields = [intro, note];
  return d;
}

async function setup() {
  const repo = new MemoryFormsRepo(TENANT);
  const docRepo = new MemoryDocumentsRepo(TENANT);
  await docRepo.saveProfile(TENANT, { legal_name: "Acme Tax LLC", display_name: "Acme Tax", email: "office@acmetax.test", time_zone: "America/Chicago" });
  const pdfs = new MemoryDocumentStore();
  let clock = new Date("2026-10-13T15:00:00Z");
  const told: string[] = [];
  const saved: Submission[] = [];
  const deps: FormDeps = {
    tenantId: TENANT, repo, stores: { uploads: new MemoryDocumentStore(), pdfs }, firms: new MemoryFirms(), commerce: new MemoryRepo(), secrets: new CrmSecrets(randomBytes(32)), linkKey: randomBytes(32),
    profile: () => docRepo.getProfile(), now: () => clock,
    told: async (n) => { told.push(n.title); },
    saveToClient: async (s) => { saved.push(s); },
    clientFor: async () => ({ full_name: client.full_name, email: client.email, phone: null, address: null }),
  };
  const form = await createForm(deps, { name: "Engagement questions", adminId: "admin" });
  await saveDraft(deps, form.id, definition(), "admin");
  await publishForm(deps, form.id, "admin");
  const auto = { repo: new MemoryAutomationRepo(), commerce: new MemoryRepo(), crm: null, email: { send: async () => ({ ok: true as const, id: "m" }) }, documents: { tenantId: TENANT, repo: docRepo, store: pdfs, linkKey: randomBytes(32) }, senders: null, fallbackSender: { from: "Acme <o@acmetax.test>", replyTo: null, label: "Acme" }, config: { origin: () => "https://app.test", supportEmail: "s@acmetax.test", supportRecipient: "o@acmetax.test", env: "production" as const, testRecipients: [] }, formAnswers: (id: string) => answerStrings(deps, id) } as unknown as AutomationDeps;
  return { deps, repo, form: (await repo.getForm(form.id))!, told, saved, auto, advance: (s: number) => { clock = new Date(clock.getTime() + s * 1000); } };
}

describe("details in forms", () => {
  test("only the listed details can be used, and they are filled in for the person looking", () => {
    assert.deepEqual(unknownTokens("Hi {{client_name}} {{ssn}} {{ client_phone }} {{x.y}}"), ["ssn", "x.y"]);
    assert.ok(!FORM_MERGE_KEYS.some((k) => /ssn|signed|order/.test(k)), "no Social Security numbers, signing or order fields");
    assert.equal(fillTokens("Dear {{client_name}}, {{firm_name}} ({{today}})", { client_name: "Jane", firm_name: "Acme", today: "Oct 13" }), "Dear Jane, Acme (Oct 13)");
    assert.equal(fillTokens("Dear {{client_name}}!", {}), "Dear !", "a general link has no client: the detail is left empty");
    assert.equal(fillTokens("{{ssn}}", { ssn: "123" }), "", "an unlisted name is never filled");
  });

  test("a form saves only with known details, and merging never changes the saved form", () => {
    const d = definition();
    assert.doesNotThrow(() => checkDefinition(d));
    const bad = definition(); bad.pages[0].sections[0].fields[0].text = "Your SSN is {{client_ssn}}";
    assert.throws(() => checkDefinition(bad), (e) => e instanceof DefinitionError && /client_ssn/.test(e.message) && e.target === bad.pages[0].sections[0].fields[0].id);
    const values = formMergeValues({ profile: { display_name: "Acme Tax", legal_name: "Acme Tax LLC", email: null, phone: null, address: null, time_zone: "America/Chicago" }, client: { full_name: "Jane Q Smith", email: "j@x.test", phone: null, address: null }, now: new Date("2026-10-13T15:00:00Z") });
    const merged = mergeDefinition(d, values);
    const fields = merged.pages[0].sections[0].fields;
    assert.equal(fields[0].text, "Hello Jane, Acme Tax needs a few details on October 13, 2026.");
    assert.equal(fields[1].label, "Anything to add for Jane Q Smith?");
    assert.equal(fields[1].defaultValue, "Jane Q Smith");
    assert.equal(d.pages[0].sections[0].fields[1].defaultValue, "{{client_name}}", "the saved form is untouched");
    const seen: string[] = []; eachText(d, (t) => seen.push(t));
    assert.ok(seen.includes("{{client_name}}"));
  });
});

describe("a form sent to a client", () => {
  test("only a published form goes to a client with an email, and the link is one-time, expiring and cancellable", async () => {
    const s = await setup();
    await assert.rejects(createInvite(s.deps, { formId: "nope", client, createdBy: "u1" }), /published form/);
    await assert.rejects(createInvite(s.deps, { formId: s.form.id, client: { ...client, email: null }, createdBy: "u1" }), /email address/);
    await assert.rejects(createInvite(s.deps, { formId: s.form.id, client: { ...client, archived_at: "2026-01-01" }, createdBy: "u1" }), /archived/);
    const { invite, token } = await createInvite(s.deps, { formId: s.form.id, client, createdBy: "u1" });
    assert.ok(token.length >= 40);
    assert.notEqual(invite.token_hash, token, "only a hash is kept");
    assert.equal(inviteStatus(invite, new Date("2026-10-14")), "sent");
    assert.deepEqual(await checkInvite(s.deps, s.form.id, token).then((r) => r.ok), true);
    assert.equal((await checkInvite(s.deps, s.form.id, "x".repeat(43))).ok, false);
    assert.equal((await checkInvite(s.deps, "other-form", token)).ok, false, "a link only opens its own form");
    await markInviteOpened(s.deps, invite);
    assert.equal(inviteStatus((await s.repo.getInviteByHash(invite.token_hash))!), "opened");
    s.advance(31 * 86_400);
    const late = await checkInvite(s.deps, s.form.id, token);
    assert.deepEqual(late, { ok: false, reason: "expired" });
    const second = await createInvite(s.deps, { formId: s.form.id, client, createdBy: "u1" });
    await revokeInvite(s.deps, second.invite.id, client.id);
    assert.deepEqual(await checkInvite(s.deps, s.form.id, second.token), { ok: false, reason: "revoked" });
    await assert.rejects(revokeInvite(s.deps, second.invite.id, "someone-else"), /wasn't found/);
  });

  test("submitting through the link ties the submission to the client, uses the link up, and saves the PDF to their files", async () => {
    const s = await setup();
    const { token } = await createInvite(s.deps, { formId: s.form.id, client, createdBy: "u1" });
    const stamp = startStamp(s.deps, s.form.id);
    s.advance(30);
    const input = { token: null, honeypot: "", stamp, answers: { note: "All good" }, signature: null, inviteToken: token };
    const { submission, pf } = await submitForm(s.deps, s.form.public_id, input, who);
    assert.equal(submission.client_id, client.id);
    assert.equal((await s.repo.getInviteByHash((await s.repo.listInvitesForClient(client.id, 5))[0].token_hash))!.submission_id, submission.id);
    assert.equal(inviteStatus((await s.repo.listInvitesForClient(client.id, 5))[0]), "completed");
    await assert.rejects(submitForm(s.deps, s.form.public_id, { ...input, stamp: startStamp(s.deps, s.form.id) }, who), /already been completed/);
    await assert.rejects(submitForm(s.deps, s.form.public_id, { ...input, inviteToken: "y".repeat(43) }, who), /not valid/);
    await afterSubmit(s.auto, s.deps, submission, pf);
    assert.deepEqual(s.saved.map((x) => x.id), [submission.id], "the PDF goes to the client's files");
    assert.deepEqual(s.told, ["Jane Q Smith completed Engagement questions"].map((t) => t.replace("Jane Q Smith", submission.respondent_name || submission.respondent_email || "Someone")));
  });

  test("a form filled in from the general link is not tied to anyone", async () => {
    const s = await setup();
    const stamp = startStamp(s.deps, s.form.id);
    s.advance(30);
    const { submission, pf } = await submitForm(s.deps, s.form.public_id, { token: null, honeypot: "", stamp, answers: { note: "Hi" }, signature: null }, who);
    assert.equal(submission.client_id ?? null, null);
    await afterSubmit(s.auto, s.deps, submission, pf);
    assert.deepEqual(s.saved, []);
    assert.ok((await publicForm(s.deps, s.form.public_id))!.state === "open");
  });
});
