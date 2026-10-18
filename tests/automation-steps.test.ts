import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { DEFAULT_WEEK } from "../lib/calendar/business.ts";
import type { Contact, ContactPort } from "../lib/automation/contact.ts";
import { emitEvent, processExecution, runClientTest, runDue, runTest, type AutomationDeps } from "../lib/automation/engine.ts";
import { branchDepth, compile, countSteps, flattenActions, stepsOf, MAX_STEPS } from "../lib/automation/steps.ts";
import { validateWorkflowInput } from "../lib/automation/validate.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import type { Step, SubjectType, Workflow } from "../lib/automation/types.ts";

const MONDAY = Date.parse("2026-10-12T15:00:00Z"); // 11:00 in New York

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  queue: SendResult[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    const next = this.queue.shift();
    if (next) return next;
    this.sent.push(m);
    return { ok: true, id: `msg_${this.sent.length}` };
  }
}

class MemoryContacts implements ContactPort {
  people = new Map<string, Contact>();
  tasks: { title: string; dueOn: string | null; executionId: string }[] = [];
  texts: { to: string | null; body: string }[] = [];
  statusChanges: string[] = [];
  async resolve(e: { subject_id?: string | null }) { return (e.subject_id && this.people.get(e.subject_id)) || null; }
  async addTag(c: Contact, tag: string) { if (c.tags.includes(tag)) return 0; c.tags.push(tag); return 1; }
  async removeTag(c: Contact, tag: string) { const n = c.tags.length; c.tags = c.tags.filter((t) => t !== tag); return n - c.tags.length; }
  async setLeadStatus(c: Contact, status: string) { if (!c.leadId) return false; c.leadStatus = status; this.statusChanges.push(status); return true; }
  async createTask(t: { title: string; dueOn: string | null; executionId: string }) {
    if (this.tasks.some((x) => x.executionId === t.executionId && x.title === t.title)) return false;
    this.tasks.push(t);
    return true;
  }
  async sendText(c: Contact, body: string) { this.texts.push({ to: c.phone, body }); return { ok: true as const }; }
}

const contact = (over: Partial<Contact> = {}): Contact => ({ name: "Ana Ruiz", email: "ana@example.com", phone: "+13375550100", smsConsent: true, leadId: "lead-1", clientId: null, customerId: null, tags: [], leadStatus: "new", variables: { appointment_time: "Monday at 11:00 AM" }, ...over });

async function setup(opts: { clockStart?: number } = {}) {
  const repo = new MemoryAutomationRepo();
  const email = new FakeEmail();
  const contacts = new MemoryContacts();
  const person = contact();
  const subjectId = randomUUID();
  contacts.people.set(subjectId, person);
  const clock = { t: opts.clockStart ?? MONDAY };
  const deps: AutomationDeps = {
    repo, commerce: new MemoryRepo(), crm: null, email, contacts,
    calendar: async () => ({ timeZone: "America/New_York", week: DEFAULT_WEEK, closures: [] }),
    config: { origin: () => "https://app.test", supportEmail: "support@x.test", supportRecipient: "support@x.test", env: "production", testRecipients: [] },
    now: () => new Date(clock.t),
  };
  const template = await repo.insertTemplate({ template_key: null, name: "Hello", subject: "Hi {{customer_first_name}}", body: "See you {{appointment_time}}.", active: true, sender_id: null, created_by: null, updated_by: null });
  const make = async (steps: Step[], over: Partial<Workflow> = {}, trigger = "appointment.booked") => repo.insertWorkflow({
    workflow_key: null, name: "Test flow", description: null, trigger_event: trigger, conditions: [], actions: [], steps, trigger_config: {},
    status: "active", max_attempts: 3, cooldown_hours: 0, created_by: null, updated_by: null, ...over,
  } as never);
  const fire = (type = "appointment.booked", key = `${type}:${subjectId}`, subjectType: SubjectType = "appointment", data: Record<string, string> = { source: "public" }) =>
    emitEvent(deps, { type, key, subject: { type: subjectType, id: subjectId }, data });
  return { repo, email, contacts, person, deps, clock, template, make, fire, subjectId };
}
const note = (text: string): Step => ({ type: "record_note", note: text });

test("a wait suspends the run, and it carries on at the right moment", async () => {
  const { repo, deps, make, fire, clock } = await setup();
  await make([note("before"), { type: "wait", amount: 2, unit: "days", mode: "business" }, note("after")]);
  const r = await fire();
  const waiting = (await repo.getExecution(r.executionIds[0]))!;
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.pc, 2);
  assert.equal(waiting.next_attempt_at, "2026-10-14T15:00:00.000Z", "two business days from Monday 11:00 is Wednesday 11:00");
  assert.equal(waiting.attempts, 0, "a wait gives the next step a fresh set of tries");
  assert.deepEqual(waiting.action_log.map((l) => `${l.path}:${l.type}`), ["1:record_note", "2:wait"]);

  clock.t = Date.parse("2026-10-13T15:00:00Z");
  assert.equal((await runDue(deps)).processed, 0, "not due yet");
  clock.t = Date.parse("2026-10-14T15:00:01Z");
  assert.equal((await runDue(deps)).processed, 1);
  const done = (await repo.getExecution(r.executionIds[0]))!;
  assert.equal(done.status, "succeeded");
  assert.deepEqual(done.action_log.map((l) => l.path), ["1", "2", "3"]);
});

test("business waits skip weekends; calendar waits do not", async () => {
  const friday = Date.parse("2026-10-16T19:00:00Z"); // 3 pm Friday in New York
  const a = await setup({ clockStart: friday });
  await a.make([{ type: "wait", amount: 1, unit: "days", mode: "business" }, note("x")]);
  const ra = await a.fire();
  assert.equal((await a.repo.getExecution(ra.executionIds[0]))!.next_attempt_at, "2026-10-19T19:00:00.000Z", "Monday");
  const b = await setup({ clockStart: friday });
  await b.make([{ type: "wait", amount: 1, unit: "days", mode: "calendar" }, note("x")]);
  const rb = await b.fire();
  assert.equal((await b.repo.getExecution(rb.executionIds[0]))!.next_attempt_at, "2026-10-17T19:00:00.000Z", "Saturday");
});

test("a branch takes the Yes or No path by the person's tags and records which", async () => {
  const s = await setup();
  await s.make([
    { type: "branch", conditions: [{ field: "contact.tags", op: "contains", value: "vip" }], then: [note("vip path")], else: [note("regular path")] },
    note("always"),
  ]);
  const regular = await s.fire();
  let log = (await s.repo.getExecution(regular.executionIds[0]))!.action_log;
  assert.deepEqual(log.map((l) => `${l.path}:${l.detail}`), ["1:Conditions not met: took the No path.", "1b.1:regular path", "2:always"]);

  s.person.tags.push("vip");
  const vip = await s.fire("appointment.booked", "second");
  log = (await s.repo.getExecution(vip.executionIds[0]))!.action_log;
  assert.deepEqual(log.map((l) => `${l.path}:${l.detail}`), ["1:Conditions met: took the Yes path.", "1a.1:vip path", "2:always"]);
});

test("branches can nest and the compiled program jumps over the path not taken", () => {
  const steps: Step[] = [{ type: "branch", conditions: [{ field: "x", op: "eq", value: "1" }], then: [{ type: "branch", conditions: [{ field: "y", op: "eq", value: "2" }], then: [note("a")], else: [note("b")] }], else: [note("c")] }, note("d")];
  const program = compile(steps);
  assert.deepEqual(program.map((i) => (i.op === "act" ? i.path : i.op)), ["branch", "branch", "1a.1a.1", "jump", "1a.1b.1", "jump", "1b.1", "2"]);
  assert.equal(branchDepth(steps), 2);
  assert.equal(countSteps(steps), 6);
  assert.equal(flattenActions(steps).length, 4);
  assert.equal(stepsOf({ steps: null, actions: [{ type: "record_note", note: "n" }] }).length, 1);
});

test("tags, lead status, tasks and texts act on the person, once", async () => {
  const s = await setup();
  await s.make([
    { type: "add_tag", tag: "booked" }, { type: "add_tag", tag: "booked" }, { type: "remove_tag", tag: "cold" },
    { type: "update_contact", field: "lead_status", value: "contacted" },
    { type: "create_task", title: "Call Ana", due_days: 2 },
    { type: "send_text", body: "See you soon" },
  ]);
  const r = await s.fire();
  const x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.status, "succeeded");
  assert.deepEqual(s.person.tags, ["booked"]);
  assert.match(x.action_log[1].detail, /already had/);
  assert.match(x.action_log[2].detail, /didn't have/);
  assert.equal(s.person.leadStatus, "contacted");
  assert.deepEqual(s.contacts.tasks.map((t) => [t.title, t.dueOn]), [["Call Ana", "2026-10-14"]]);
  assert.deepEqual(s.contacts.texts, [{ to: "+13375550100", body: "See you soon" }]);
});

test("a text is never sent without consent or a number", async () => {
  const s = await setup();
  s.person.smsConsent = false;
  await s.make([{ type: "send_text", body: "Hi" }]);
  const r = await s.fire();
  const x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.action_log[0].status, "skipped");
  assert.match(x.action_log[0].detail, /hasn't agreed to texts/);
  assert.equal(s.contacts.texts.length, 0);
  s.person.smsConsent = true; s.person.phone = null;
  const r2 = await s.fire("appointment.booked", "two");
  assert.match((await s.repo.getExecution(r2.executionIds[0]))!.action_log[0].detail, /no mobile number/);
});

test("steps about a person say so when the event isn't about one", async () => {
  const s = await setup();
  await s.make([{ type: "add_tag", tag: "x" }, { type: "create_task", title: "Follow up", due_days: null }], {}, "form.submitted");
  const r = await emitEvent(s.deps, { type: "form.submitted", key: "f1", data: { form_id: "abc" } });
  const x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.status, "succeeded");
  assert.match(x.action_log[0].detail, /nobody to tag/);
  assert.equal(x.action_log[1].status, "ok", "a task needs no person");
});

test("an email goes to the person the event is about, with their appointment details", async () => {
  const s = await setup();
  await s.make([{ type: "send_email", template_id: s.template.id, to: "customer", include_setup_link: false }]);
  await s.fire();
  assert.equal(s.email.sent.length, 1);
  assert.equal(s.email.sent[0].to, "ana@example.com");
  assert.match(s.email.sent[0].subject, /Hi Ana/);
  assert.match(s.email.sent[0].text, /Monday at 11:00 AM/);
});

test("a failure part-way retries from that step and does not repeat the ones before", async () => {
  const s = await setup();
  await s.make([{ type: "send_email", template_id: s.template.id, to: "customer", include_setup_link: false }, { type: "wait", amount: 1, unit: "hours", mode: "calendar" }, { type: "send_email", template_id: s.template.id, to: "customer", include_setup_link: false }]);
  const r = await s.fire();
  assert.equal(s.email.sent.length, 1);
  s.clock.t += 3_700_000;
  s.email.queue.push({ ok: false, kind: "transient", message: "provider down" });
  await runDue(s.deps);
  let x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.status, "retrying");
  assert.equal(x.pc, 2, "stays on the failed step");
  s.clock.t += 3_600_000;
  await runDue(s.deps);
  x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.status, "succeeded");
  assert.equal(s.email.sent.length, 2, "the first email was not sent again");
});

test("a paused workflow does not carry on after its wait", async () => {
  const s = await setup();
  const wf = await s.make([{ type: "wait", amount: 1, unit: "hours", mode: "calendar" }, note("after")]);
  const r = await s.fire();
  await s.repo.updateWorkflow(wf.id, { status: "paused" });
  s.clock.t += 3_700_000;
  await runDue(s.deps);
  const x = (await s.repo.getExecution(r.executionIds[0]))!;
  assert.equal(x.status, "skipped");
  assert.match(x.error ?? "", /paused or archived/);
});

test("a safe test skips waits, takes a branch, and changes nothing", async () => {
  const s = await setup();
  const wf = await s.make([
    { type: "wait", amount: 3, unit: "days", mode: "business" },
    { type: "branch", conditions: [{ field: "source", op: "eq", value: "public" }], then: [{ type: "add_tag", tag: "t" }, { type: "send_text", body: "hello" }], else: [note("else")] },
    { type: "create_task", title: "T", due_days: 1 },
  ]);
  const x = await runTest(s.deps, wf.id, { id: "a", email: "admin@x.test" });
  assert.equal(x.status, "succeeded");
  assert.match(x.action_log[0].detail, /Skipped in test: would wait 3 business days/);
  assert.equal(s.person.tags.length, 0);
  assert.equal(s.contacts.tasks.length, 0);
  assert.equal(s.contacts.texts.length, 0);
  assert.equal(x.action_log.filter((l) => l.status === "skipped").length >= 2, true);
});

test("a test with a real client checks sends but also never changes the client", async () => {
  const s = await setup();
  const wf = await s.make([{ type: "wait", amount: 1, unit: "days", mode: "calendar" }, { type: "add_tag", tag: "t" }, note("n")]);
  // a customer is needed for the client test
  const customer = await (s.deps.commerce as MemoryRepo).createCustomer({ email: "c@example.com", full_name: "C", stripe_customer_id: null });
  const x = await runClientTest(s.deps, wf.id, customer.id, { id: "a", email: "admin@x.test" });
  assert.equal(x.status, "succeeded");
  assert.equal(s.person.tags.length, 0);
});

test("date-based workflows only react to their own number of days", async () => {
  const s = await setup();
  const week = await s.make([note("a")], { trigger_config: { offset_days: -7 } }, "date.return_due");
  await s.make([note("b")], { trigger_config: { offset_days: 0 } }, "date.return_due");
  const r = await emitEvent(s.deps, { type: "date.return_due", key: "d1", subject: { type: "return", id: randomUUID() }, data: { offset_days: -7 } });
  assert.equal(r.executionIds.length, 1);
  assert.equal((await s.repo.getExecution(r.executionIds[0]))!.workflow_id, week.id);
});

test("process: an already finished execution is not claimed again", async () => {
  const s = await setup();
  await s.make([note("a")]);
  const r = await s.fire();
  assert.equal(await processExecution(s.deps, r.executionIds[0]), null);
});

// ------------------------------------------------------------------ validation

const base = { name: "Flow", trigger_event: "appointment.booked", conditions: [] as { field: string; op: string; value: string }[] };
const tpl = [{ id: "t1" }];

test("validation accepts a tree and keeps a flat copy of its actions", () => {
  const v = validateWorkflowInput({ ...base, steps: [
    { type: "send_email", template_id: "t1", to: "customer" },
    { type: "wait", amount: "2", unit: "days", mode: "business" },
    { type: "branch", conditions: [{ field: "contact.tags", op: "contains", value: "VIP " }], then: [{ type: "add_tag", tag: "Warm" }], else: [{ type: "create_task", title: " Call ", due_days: "3" }] },
  ] }, tpl);
  assert.equal(v.steps!.length, 3);
  assert.deepEqual(v.steps![1], { type: "wait", amount: 2, unit: "days", mode: "business" });
  assert.deepEqual((v.steps![2] as { conditions: unknown }).conditions, [{ field: "contact.tags", op: "contains", value: "vip" }]);
  assert.deepEqual(v.actions.map((a) => a.type), ["send_email", "add_tag", "create_task"]);
});

test("the old flat form still works and stays flat", () => {
  const v = validateWorkflowInput({ ...base, actions: [{ type: "record_note", note: "n" }] }, tpl);
  assert.equal(v.steps, null);
  assert.equal(v.actions.length, 1);
  assert.throws(() => validateWorkflowInput({ ...base, actions: Array.from({ length: 6 }, () => ({ type: "record_note", note: "n" })) }, tpl), /at most 5/);
});

test("limits: 25 steps, branches 3 deep, waits within range, something must act", () => {
  const notes = Array.from({ length: MAX_STEPS + 1 }, () => ({ type: "record_note", note: "n" }));
  assert.throws(() => validateWorkflowInput({ ...base, steps: notes }, tpl), /at most 25/);
  assert.ok(validateWorkflowInput({ ...base, steps: notes.slice(0, MAX_STEPS) }, tpl));
  const cond = [{ field: "contact.is_lead", op: "eq", value: "yes" }];
  const deep = (n: number): unknown => (n === 0 ? [{ type: "record_note", note: "x" }] : [{ type: "branch", conditions: cond, then: deep(n - 1), else: [] }]);
  assert.ok(validateWorkflowInput({ ...base, steps: deep(3) as never }, tpl));
  assert.throws(() => validateWorkflowInput({ ...base, steps: deep(4) as never }, tpl), /3 levels/);
  assert.throws(() => validateWorkflowInput({ ...base, steps: [{ type: "wait", amount: 0, unit: "days" }, { type: "record_note", note: "n" }] }, tpl), /1 to 365 days/);
  assert.throws(() => validateWorkflowInput({ ...base, steps: [{ type: "wait", amount: 5, unit: "weeks" }, { type: "record_note", note: "n" }] }, tpl), /minutes, hours or days/);
  assert.throws(() => validateWorkflowInput({ ...base, steps: [{ type: "wait", amount: 1, unit: "days" }] }, tpl), /does something/);
});

test("validation explains bad steps in plain words", () => {
  const bad = (step: unknown, re: RegExp) => assert.throws(() => validateWorkflowInput({ ...base, steps: [step as never] }, tpl), re);
  bad({ type: "send_email", template_id: "nope" }, /email template/);
  bad({ type: "add_tag", tag: "a, b" }, /one tag/);
  bad({ type: "update_contact", value: "winning" }, /lead status/);
  bad({ type: "send_text", body: "" }, /Write the text/);
  bad({ type: "send_text", body: "x".repeat(321) }, /320/);
  bad({ type: "create_task", title: "" }, /title/);
  bad({ type: "create_task", title: "t", due_days: "400" }, /0 to 365/);
  bad({ type: "branch", conditions: [], then: [], else: [] }, /at least one condition/);
  bad({ type: "branch", conditions: [{ field: "contact.tags", op: "eq", value: "x" }], then: [], else: [] }, /has the tag/);
  bad({ type: "mystery" }, /no type/);
  assert.throws(() => validateWorkflowInput({ ...base, conditions: [{ field: "contact.tags", op: "contains", value: "x" }], steps: [{ type: "record_note", note: "n" }] }, tpl), /If \/ else step/);
});

test("a date-based trigger takes days before or after", () => {
  const v = validateWorkflowInput({ name: "Reminder", trigger_event: "date.return_due", offset_days: "-7", conditions: [], steps: [{ type: "create_task", title: "Check return", due_days: 0 }] }, tpl);
  assert.deepEqual(v.trigger_config, { offset_days: -7 });
  assert.throws(() => validateWorkflowInput({ name: "Reminder", trigger_event: "date.return_due", offset_days: "999", conditions: [], steps: [{ type: "record_note", note: "n" }] }, tpl), /-365 and 365/);
});
