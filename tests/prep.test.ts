import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import { handoffCsv } from "../lib/prep/export.ts";
import {
  addChecklistItem, addMyClient, assignReturn, checklistFor, DEFAULT_CHECKLIST, handOff, loadClient, loadReturn, removeChecklistItem,
  savePrepNotes, setChecklistDone, setPrepStatus, startReturn, visibleClients, visibleReturns, type HandoffMail,
} from "../lib/prep/service.ts";
import type { ChecklistItem, Handoff, PrepDeps, PrepRepo, Scope } from "../lib/prep/types.ts";
import type { AuditInput } from "../lib/practice/service.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

// The return-prep and assignment layer: people see their own clients and assigned returns; offices stay apart;
// preparation moves forward through its steps; a handoff is a file that locks the return. Fake data only.

class MemoryPrep implements PrepRepo {
  items: ChecklistItem[] = []; handoffs: Handoff[] = [];
  async listChecklist(returnId: string) { return structuredClone(this.items.filter((i) => i.return_id === returnId).sort((a, b) => a.position - b.position)); }
  async insertChecklist(returnId: string, labels: string[], startAt: number) {
    const rows = labels.map((label, i): ChecklistItem => ({ id: randomUUID(), tenant_id: "t", return_id: returnId, label, position: startAt + i, done_at: null, done_by: null, created_at: "" }));
    this.items.push(...rows); return structuredClone(rows);
  }
  async getChecklistItem(id: string) { return structuredClone(this.items.find((i) => i.id === id) ?? null); }
  async updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, "done_at" | "done_by">>) { const i = this.items.find((x) => x.id === id)!; Object.assign(i, patch); return structuredClone(i); }
  async deleteChecklistItem(id: string) { this.items = this.items.filter((i) => i.id !== id); }
  async insertHandoff(input: Parameters<PrepRepo["insertHandoff"]>[0]) { const h: Handoff = { id: randomUUID(), tenant_id: "t", created_at: "", ...input }; this.handoffs.push(h); return structuredClone(h); }
  async listHandoffs(returnId: string) { return structuredClone(this.handoffs.filter((h) => h.return_id === returnId)); }
}

const NOW = new Date("2026-10-17T12:00:00Z");
const PAT = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const OFFICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scope = (userId: string, all = false, organizationId: string | null = null): Scope => ({ userId, all, organizationId });

function setup() {
  const ws = new MemoryWorkspace();
  const prep = new MemoryPrep();
  const audit: AuditInput[] = [];
  const deps: PrepDeps = { ws, prep, audit: async (a) => { audit.push(a); }, now: () => NOW };
  return { ws, prep, audit, deps };
}
const sends: EmailMessage[] = [];
const mailer = (result: SendResult = { ok: true, id: "e1" }, over: Partial<HandoffMail> = {}): HandoffMail => ({
  email: { send: async (m) => { sends.push(m); return result; } } as EmailSender,
  sender: async () => ({ from: "Pat <pat@example.com>", replyTo: null, label: "Pat" }),
  env: "production", testRecipients: [], docs: async () => [{ title: "W-2", file_type: "pdf" }], preparerName: "Pat Example", preparerEmail: "pat@example.com", ...over,
});
const client = (name: string) => ({ full_name: name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "", ssn_last4: "1234", address: "" });

describe("people see their own clients and assigned returns", () => {
  test("a preparer's clients are theirs alone; a stranger gets the same 'not found' as a missing client", async () => {
    const { deps } = setup();
    const a = await addMyClient(deps, scope(PAT), client("Ann Client"));
    await addMyClient(deps, scope(SAM), client("Bob Client"));
    assert.deepEqual((await visibleClients(deps, scope(PAT))).map((c) => c.full_name), ["Ann Client"]);
    assert.deepEqual((await visibleClients(deps, scope(SAM))).map((c) => c.full_name), ["Bob Client"]);
    await assert.rejects(loadClient(deps, scope(SAM), a.id), /wasn't found/);
    await assert.rejects(loadClient(deps, scope(SAM), randomUUID()), /wasn't found/);
    assert.equal((await loadClient(deps, scope(PAT), a.id)).owner_id, PAT);
  });
  test("a person with 'all' sees every client in the account", async () => {
    const { deps } = setup();
    await addMyClient(deps, scope(PAT), client("Ann Client"));
    await addMyClient(deps, scope(SAM), client("Bob Client"));
    assert.equal((await visibleClients(deps, scope(PAT, true))).length, 2);
  });
  test("a return assigned to someone makes its client visible to them, and only that return", async () => {
    const { deps } = setup();
    const ann = await addMyClient(deps, scope(PAT), client("Ann Client"));
    const r1 = await startReturn(deps, scope(PAT), { client_id: ann.id, tax_year: "2025", kind: "original" }, "intake");
    await startReturn(deps, scope(PAT), { client_id: ann.id, tax_year: "2024", kind: "original" }, "intake");
    assert.equal((await visibleReturns(deps, scope(SAM))).length, 0);
    await assignReturn(deps, scope(PAT), r1.id, SAM, [PAT, SAM]);
    assert.deepEqual((await visibleClients(deps, scope(SAM))).map((c) => c.full_name), ["Ann Client"]);
    assert.deepEqual((await visibleReturns(deps, scope(SAM))).map((r) => r.id), [r1.id]);
    assert.deepEqual((await visibleReturns(deps, scope(SAM), { assignedOnly: true })).map((r) => r.id), [r1.id]);
    assert.equal((await loadReturn(deps, scope(SAM), r1.id)).ret.assignee_id, SAM);
  });
  test("offices stay apart, and apart from the account's own work", async () => {
    const { deps } = setup();
    const a = await addMyClient(deps, scope(PAT, true, OFFICE_A), client("Office A Client"));
    await addMyClient(deps, scope(SAM, true, OFFICE_B), client("Office B Client"));
    await addMyClient(deps, scope(PAT, true, null), client("Own Client"));
    assert.deepEqual((await visibleClients(deps, scope(PAT, true, OFFICE_A))).map((c) => c.full_name), ["Office A Client"]);
    assert.deepEqual((await visibleClients(deps, scope(SAM, true, OFFICE_B))).map((c) => c.full_name), ["Office B Client"]);
    assert.deepEqual((await visibleClients(deps, scope(PAT, true, null))).map((c) => c.full_name), ["Own Client"]);
    await assert.rejects(loadClient(deps, scope(SAM, true, OFFICE_B), a.id), /wasn't found/);
  });
});

describe("preparing a return", () => {
  const begin = async () => {
    const s = setup();
    const c = await addMyClient(s.deps, scope(PAT), client("Ann Client"));
    const r = await startReturn(s.deps, scope(PAT), { client_id: c.id, tax_year: "2025", kind: "original" }, "intake");
    return { ...s, c, r };
  };
  test("starting a return assigns it to the starter and seeds the intake checklist; the client's year can't be started twice", async () => {
    const { deps, r, c } = await begin();
    assert.equal(r.assignee_id, PAT);
    assert.equal(r.prep_status, "not_started");
    assert.equal((await checklistFor(deps, scope(PAT), r.id)).length, DEFAULT_CHECKLIST.length);
    await assert.rejects(startReturn(deps, scope(PAT), { client_id: c.id, tax_year: "2025", kind: "original" }, "intake"), /already has an original return/);
    await assert.rejects(startReturn(deps, scope(SAM), { client_id: c.id, tax_year: "2023", kind: "original" }, "intake"), /wasn't found/);
  });
  test("status moves forward step by step, can be sent back from review, and is audited", async () => {
    const { deps, r, audit } = await begin();
    await assert.rejects(setPrepStatus(deps, scope(PAT), r.id, "ready_for_review"), /can't go straight/);
    await assert.rejects(setPrepStatus(deps, scope(PAT), r.id, "handed_off"), /can't go straight/);
    assert.equal((await setPrepStatus(deps, scope(PAT), r.id, "in_prep")).prep_status, "in_prep");
    assert.equal((await setPrepStatus(deps, scope(PAT), r.id, "ready_for_review")).prep_status, "ready_for_review");
    assert.equal((await setPrepStatus(deps, scope(PAT), r.id, "in_prep")).prep_status, "in_prep");
    await assert.rejects(setPrepStatus(deps, scope(SAM), r.id, "ready_for_review"), /wasn't found/);
    assert.deepEqual(audit.filter((a) => a.action === "prep_status_changed").map((a) => a.detail), [{ from: "not_started", to: "in_prep" }, { from: "in_prep", to: "ready_for_review" }, { from: "ready_for_review", to: "in_prep" }]);
  });
  test("checklist items can be added, ticked and removed, within limits and only by someone who can see the return", async () => {
    const { deps, r } = await begin();
    const item = await addChecklistItem(deps, scope(PAT), r.id, "  Dependent SSNs  ");
    assert.equal(item.label, "Dependent SSNs");
    await assert.rejects(addChecklistItem(deps, scope(PAT), r.id, "   "), /Write the checklist item/);
    assert.ok((await setChecklistDone(deps, scope(PAT), item.id, true)).done_at);
    assert.equal((await setChecklistDone(deps, scope(PAT), item.id, false)).done_at, null);
    await assert.rejects(setChecklistDone(deps, scope(SAM), item.id, true), /wasn't found/);
    await removeChecklistItem(deps, scope(PAT), item.id);
    assert.equal((await checklistFor(deps, scope(PAT), r.id)).length, DEFAULT_CHECKLIST.length);
  });
  test("prep notes are saved trimmed and capped", async () => {
    const { deps, r } = await begin();
    assert.equal((await savePrepNotes(deps, scope(PAT), r.id, "  Needs 1098-T  ")).notes, "Needs 1098-T");
    assert.equal((await savePrepNotes(deps, scope(PAT), r.id, "x".repeat(5000))).notes?.length, 2000);
  });
});

describe("assigning a return", () => {
  test("the owner or an 'all' person assigns, to a member only; a preparer can't hand off someone else's", async () => {
    const { deps } = setup();
    const c = await addMyClient(deps, scope(PAT), client("Ann Client"));
    const r = await startReturn(deps, scope(PAT), { client_id: c.id, tax_year: "2025", kind: "original" }, "intake");
    await assert.rejects(assignReturn(deps, scope(PAT), r.id, SAM, [PAT]), /Choose someone who works here/);
    await assignReturn(deps, scope(PAT), r.id, SAM, [PAT, SAM]);
    // Sam now works it but doesn't own the client.
    await assert.rejects(assignReturn(deps, scope(SAM), r.id, PAT, [PAT, SAM]), /Only the client's owner or the office's ERO/);
    assert.equal((await assignReturn(deps, scope(SAM, true), r.id, PAT, [PAT, SAM])).assignee_id, PAT);
  });
});

describe("handing a return to an ERO", () => {
  const ready = async () => {
    const s = setup();
    const c = await addMyClient(s.deps, scope(PAT), { ...client("=Ann Client"), address: '1 Main St, "Apt" 2' });
    const r = await startReturn(s.deps, scope(PAT), { client_id: c.id, tax_year: "2025", kind: "original" }, "intake");
    await savePrepNotes(s.deps, scope(PAT), r.id, "Bring 1098-T");
    await setPrepStatus(s.deps, scope(PAT), r.id, "in_prep");
    await setPrepStatus(s.deps, scope(PAT), r.id, "ready_for_review");
    sends.length = 0;
    return { ...s, c, r };
  };
  test("sends a CSV file by email, records it, and locks the return", async () => {
    const { deps, prep, r, ws } = await ready();
    const h = await handOff(deps, scope(PAT), r.id, " ERO@Example.com ", mailer());
    assert.equal(h.to_email, "ero@example.com");
    assert.equal(h.status, "sent");
    assert.equal(sends.length, 1);
    assert.equal(sends[0].attachments?.[0].filename, "return-2025-original-ann-client.csv");
    assert.equal(sends[0].replyTo, "pat@example.com");
    const csv = new TextDecoder().decode(sends[0].attachments![0].content);
    assert.match(csv, /Prep notes,Bring 1098-T/);
    assert.match(csv, /'=Ann Client/); // formula guard
    assert.match(csv, /"1 Main St, ""Apt"" 2"/);
    assert.doesNotMatch(csv, new RegExp(r.id));
    assert.equal(prep.handoffs.length, 1);
    assert.equal((await ws.getReturn(r.id))!.prep_status, "handed_off");
    await assert.rejects(setPrepStatus(deps, scope(PAT), r.id, "in_prep"), /handed to an ERO/);
    await assert.rejects(savePrepNotes(deps, scope(PAT), r.id, "late"), /handed to an ERO/);
    await assert.rejects(handOff(deps, scope(PAT), r.id, "ero@example.com", mailer()), /already handed/);
    await assert.rejects(assignReturn(deps, scope(PAT), r.id, SAM, [PAT, SAM]), /handed to an ERO/);
  });
  test("needs 'ready for review' and a valid address; another person's return is 'not found'", async () => {
    const { deps, c } = await ready();
    const r2 = await startReturn(deps, scope(PAT), { client_id: c.id, tax_year: "2024", kind: "original" }, "intake");
    await assert.rejects(handOff(deps, scope(PAT), r2.id, "ero@example.com", mailer()), /ready for review/);
    const r1 = (await visibleReturns(deps, scope(PAT))).find((r) => r.tax_year === 2025)!;
    await assert.rejects(handOff(deps, scope(PAT), r1.id, "not-an-address", mailer()), /ERO's email/);
    await assert.rejects(handOff(deps, scope(SAM), r1.id, "ero@example.com", mailer()), /wasn't found/);
    assert.equal(sends.length, 0);
  });
  test("outside production only the test list is contacted", async () => {
    const { deps, r } = await ready();
    await assert.rejects(handOff(deps, scope(PAT), r.id, "ero@example.com", mailer(undefined, { env: "preview" })), /test list/);
    assert.equal(sends.length, 0);
    assert.equal((await handOff(deps, scope(PAT), r.id, "ero@example.com", mailer(undefined, { env: "preview", testRecipients: ["ERO@example.com"] }))).status, "sent");
  });
  test("a failed send is recorded and leaves the return open", async () => {
    const { deps, prep, r, ws } = await ready();
    await assert.rejects(handOff(deps, scope(PAT), r.id, "ero@example.com", mailer({ ok: false, kind: "permanent", message: "mailbox full" })), /Not sent/);
    assert.equal(prep.handoffs[0].status, "failed");
    assert.equal((await ws.getReturn(r.id))!.prep_status, "ready_for_review");
  });
});

describe("the export file", () => {
  test("has no internal ids, only the SSN's last four, and escapes spreadsheet formulas", () => {
    const csv = handoffCsv({
      client: { id: "c-secret", tenant_id: "t-secret", full_name: "@Cmd", email: null, phone: null, ssn_last4: "9876", address: null, archived_at: null, created_by: null, created_at: "", updated_at: "", owner_id: null, organization_id: null },
      ret: { id: "r-secret", tenant_id: "t-secret", client_id: "c-secret", tax_year: 2025, kind: "amendment", parent_id: null, stage_id: "x", due_on: null, filed_on: null, notes: "-1+1", archived_at: null, created_at: "", updated_at: "", assignee_id: null, prep_status: "ready_for_review", handed_off_at: null, organization_id: null },
      items: [], docs: [], preparer: "Pat",
    });
    assert.doesNotMatch(csv, /secret/);
    assert.match(csv, /SSN \(last 4\),9876/);
    assert.match(csv, /Name,'@Cmd/);
    assert.match(csv, /Prep notes,'-1\+1/);
    assert.match(csv, /Type,Amendment/);
  });
});
