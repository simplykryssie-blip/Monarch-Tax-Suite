import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { archivePipeline, checkStages, createPipeline, deletePipeline, DEFAULT_RETURN_STAGES, makeDefault, returnsStages, savePipeline } from "../lib/pipelines/service.ts";
import type { Pipeline, PipelineInput, PipelinesRepo } from "../lib/pipelines/types.ts";
import { checkSms, smsSegments } from "../lib/automation/sms.ts";
import { historyRows } from "../lib/automation/history.ts";
import type { AutomationEvent, Execution } from "../lib/automation/types.ts";

class MemoryPipelines implements PipelinesRepo {
  rows: Pipeline[] = [];
  async list() { return structuredClone(this.rows); }
  async get(id: string) { return structuredClone(this.rows.find((p) => p.id === id) ?? null); }
  async insert(input: PipelineInput & { is_default: boolean; created_by: string | null }) {
    const p: Pipeline = { ...structuredClone(input), id: `p${this.rows.length + 1}`, tenant_id: "t", archived_at: null, created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" };
    this.rows.push(p);
    return structuredClone(p);
  }
  async update(id: string, patch: Partial<Pick<Pipeline, "name" | "stages" | "is_default" | "archived_at">>) {
    const p = this.rows.find((x) => x.id === id)!;
    Object.assign(p, structuredClone(patch));
    return structuredClone(p);
  }
  async remove(id: string) { this.rows = this.rows.filter((p) => p.id !== id); }
}

describe("pipelines", () => {
  test("stages are checked: 2 to 15, named once each, a finishing stage, a hex colour", () => {
    assert.throws(() => checkStages([{ name: "Only" }]), /at least 2/);
    assert.throws(() => checkStages(Array.from({ length: 16 }, (_, i) => ({ name: `S${i}`, done: i === 15 }))), /up to 15/);
    assert.throws(() => checkStages([{ name: "A" }, { name: "a", done: true }]), /Two stages are named/);
    assert.throws(() => checkStages([{ name: "A" }, { name: "B" }]), /finished/);
    assert.throws(() => checkStages([{ name: "" }, { name: "B", done: true }]), /needs a name/);
    assert.throws(() => checkStages("not json"), /could not be read/);
    const ok = checkStages(JSON.stringify([{ name: "  New   lead ", color: "#ABCDEF" }, { name: "Won", color: "javascript:x", done: true }]));
    assert.deepEqual(ok.map((s) => [s.name, s.color, s.done]), [["New lead", "#abcdef", false], ["Won", "#64748b", true]]);
    assert.equal(new Set(ok.map((s) => s.id)).size, 2);
  });

  test("the first tax-return pipeline becomes the default; making another the default moves it; the default can't be archived", async () => {
    const repo = new MemoryPipelines();
    const a = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES }, "u");
    const b = await createPipeline(repo, { name: "Tax returns 2027", kind: "returns", stages: DEFAULT_RETURN_STAGES }, "u");
    const other = await createPipeline(repo, { name: "Onboarding", stages: [{ name: "Start" }, { name: "End", done: true }] }, "u");
    assert.deepEqual([a.is_default, b.is_default, other.is_default], [true, false, false]);
    await assert.rejects(makeDefault(repo, other.id), /Only a tax-return pipeline/);
    await makeDefault(repo, b.id);
    assert.deepEqual((await repo.list()).map((p) => p.is_default), [false, true, false]);
    await assert.rejects(archivePipeline(repo, b.id, true), /Make another/);
    await archivePipeline(repo, a.id, true);
    assert.equal(returnsStages(await repo.list()).pipeline?.id, b.id);
  });

  test("saving renames and restages; the board falls back to the built-in stages when there is no pipeline", async () => {
    const repo = new MemoryPipelines();
    assert.deepEqual(returnsStages([]).stages, DEFAULT_RETURN_STAGES);
    const p = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES }, "u");
    const saved = await savePipeline(repo, p.id, { name: "My returns", stages: [{ name: "In" }, { name: "Out", done: true }] });
    assert.equal(saved.name, "My returns");
    assert.deepEqual(returnsStages(await repo.list()).stages.map((s) => s.name), ["In", "Out"]);
  });
});

describe("text templates", () => {
  test("plain text only, up to 480 characters, known placeholders", () => {
    assert.deepEqual(checkSms({ name: " Reminder ", body: "Hi {{customer_first_name}}, your return is ready." }), { name: "Reminder", body: "Hi {{customer_first_name}}, your return is ready." });
    assert.throws(() => checkSms({ name: "x", body: "Hi" }), /name/);
    assert.throws(() => checkSms({ name: "Reminder", body: "" }), /Write the message/);
    assert.throws(() => checkSms({ name: "Reminder", body: "x".repeat(481) }), /480/);
    assert.throws(() => checkSms({ name: "Reminder", body: "Hi {{nope}}" }), /Unknown placeholder/);
    assert.throws(() => checkSms({ name: "Reminder", body: "{{embed_instructions}}" }), /Unknown placeholder/);
    assert.equal(smsSegments("a".repeat(160)), 1);
    assert.equal(smsSegments("a".repeat(161)), 2);
  });
});

describe("run history", () => {
  const exec = (over: Partial<Execution>): Execution => ({
    id: "e1", workflow_id: "w1", event_id: "ev1", status: "succeeded", is_test: false, attempts: 1, max_attempts: 4, next_attempt_at: null, started_at: null, finished_at: null,
    action_log: [], error: null, error_kind: null, provider_message_id: null, created_at: "2026-10-15T12:00:00Z", updated_at: "2026-10-15T12:00:00Z", ...over,
  });
  const event = (over: Partial<AutomationEvent> = {}): AutomationEvent => ({ id: "ev1", event_key: "k", event_type: "x", license_id: null, customer_id: "c1", order_id: null, data: {}, created_at: "2026-10-15T12:00:00Z", ...over });

  test("one row per step with who, when, and completed or error", () => {
    const rows = historyRows({
      executions: [exec({ status: "failed", error: "No valid address", action_log: [
        { index: 0, type: "send_email", status: "ok", detail: "Email sent", at: "t" },
        { index: 1, type: "send_document", status: "failed", detail: "Document missing", at: "t" },
      ] })],
      workflows: new Map([["w1", "Welcome"]]), events: new Map([["ev1", event()]]), people: new Map([["c1", "Casey Client"]]), plannedSteps: new Map(),
    });
    assert.deepEqual(rows.map((r) => [r.who, r.workflow, r.step, r.result]), [["Casey Client", "Welcome", "1. Send email", "completed"], ["Casey Client", "Welcome", "2. Send a document", "error"]]);
    assert.deepEqual(rows.map((r) => [r.first, r.span, r.canRetry]), [[true, 2, true], [false, 2, false]]);
  });

  test("tests are labelled, a run that failed before any step still shows its error, and waiting steps are listed", () => {
    const rows = historyRows({
      executions: [
        exec({ id: "a", is_test: true }),
        exec({ id: "b", is_test: true, event_id: "ev2", action_log: [{ index: 0, type: "send_email", status: "skipped", detail: "Skipped in test", at: "t" }] }),
        exec({ id: "c", status: "failed", error: "Workflow record is missing" }),
        exec({ id: "d", status: "retrying", next_attempt_at: "2026-10-15T13:00:00Z", action_log: [{ index: 0, type: "send_email", status: "ok", detail: "Sent", at: "t" }] }),
      ],
      workflows: new Map([["w1", "Welcome"]]),
      events: new Map([["ev1", event({ customer_id: null })], ["ev2", event({ id: "ev2", data: { test_client: true } })]]),
      people: new Map([["c1", "Casey Client"]]),
      plannedSteps: new Map([["w1", ["send_email", "send_document"]]]),
    });
    const by = (id: string) => rows.filter((r) => r.executionId === id);
    assert.equal(by("a")[0].who, "Test run (sample data)");
    assert.equal(by("b")[0].who, "Casey Client (test)");
    assert.equal(by("b")[0].result, "skipped");
    assert.deepEqual([by("c")[0].step, by("c")[0].result, by("c")[0].detail], ["—", "error", "Workflow record is missing"]);
    assert.deepEqual(by("d").map((r) => r.result), ["completed", "waiting"]);
  });
});

describe("creating a pipeline twice", () => {
  const two = [{ name: "Start" }, { name: "End", done: true }];
  test("a repeated create returns the first pipeline instead of inserting another", async () => {
    const repo = new MemoryPipelines();
    const t0 = new Date("2026-10-15T17:37:42Z");
    const a = await createPipeline(repo, { name: "Onboarding", stages: two }, "u", () => t0);
    repo.rows[0].created_at = t0.toISOString();
    const b = await createPipeline(repo, { name: " onboarding ", stages: two }, "u", () => new Date(t0.getTime() + 1700));
    assert.equal(b.id, a.id);
    assert.equal(repo.rows.length, 1);
    const later = await createPipeline(repo, { name: "Onboarding", stages: two }, "u", () => new Date(t0.getTime() + 5 * 60_000));
    assert.notEqual(later.id, a.id, "a deliberate create a few minutes later is a new pipeline");
  });

  test("the quick start never makes a second tax-return pipeline", async () => {
    const repo = new MemoryPipelines();
    const a = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES, quickStart: true }, "u");
    const b = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES, quickStart: true }, "u", () => new Date("2027-01-01T00:00:00Z"));
    assert.equal(b.id, a.id);
    assert.equal(repo.rows.length, 1);
    assert.equal(returnsStages(await repo.list()).pipeline?.id, a.id);
  });

  test("a race the check misses is caught by the database's unique name and returns the first", async () => {
    const repo = new MemoryPipelines();
    const first = await createPipeline(repo, { name: "Onboarding", stages: two }, "u");
    const realInsert = repo.insert.bind(repo);
    let listed = 0;
    repo.list = async () => (listed++ === 0 ? [] : structuredClone(repo.rows));
    repo.insert = async () => { throw new Error('duplicate key value violates unique constraint "pipelines_active_name_key"'); };
    const again = await createPipeline(repo, { name: "Onboarding", stages: two }, "u", () => new Date("2027-01-01T00:00:00Z"));
    assert.equal(again.id, first.id);
    repo.insert = realInsert;
  });

  test("renaming, editing stages, adding, removing and reordering all update the same record", async () => {
    const repo = new MemoryPipelines();
    const p = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES, quickStart: true }, "u");
    const noComplete = DEFAULT_RETURN_STAGES.filter((s) => s.id !== "complete").map((s, i, all) => ({ ...s, done: i === all.length - 1 }));
    await savePipeline(repo, p.id, { name: "Tax Return Intake", stages: noComplete });
    await savePipeline(repo, p.id, { name: "Tax Return Intake", stages: [...noComplete].reverse().map((s, i) => ({ ...s, done: i === 0 })) });
    await savePipeline(repo, p.id, { name: "Tax Return Intake", stages: [...noComplete, { name: "Extra", done: false }] });
    assert.equal(repo.rows.length, 1);
    assert.equal(repo.rows[0].name, "Tax Return Intake");
    assert.equal(repo.rows[0].stages.length, 8);
    assert.equal(returnsStages(await repo.list()).pipeline?.id, p.id);
  });

  test("full lifecycle: create, edit, archive, restore, delete", async () => {
    const repo = new MemoryPipelines();
    const returns = await createPipeline(repo, { name: "Tax returns", kind: "returns", stages: DEFAULT_RETURN_STAGES, quickStart: true }, "u");
    const p = await createPipeline(repo, { name: "Bookkeeping", stages: [{ name: "To do" }, { name: "Done", done: true }] }, "u");
    await savePipeline(repo, p.id, { name: "Monthly bookkeeping", stages: [{ name: "To do" }, { name: "Doing" }, { name: "Done", done: true }] });
    assert.equal((await repo.get(p.id))?.stages.length, 3);

    await assert.rejects(deletePipeline(repo, p.id), /Archive the pipeline first/);
    await archivePipeline(repo, p.id, true);
    await assert.rejects(savePipeline(repo, p.id, { name: "X pipeline", stages: [{ name: "A" }, { name: "B", done: true }] }), /wasn't found/);
    await archivePipeline(repo, p.id, false);
    assert.equal((await repo.get(p.id))?.archived_at, null);

    // A restore can't make two active pipelines with the same name.
    await archivePipeline(repo, p.id, true);
    await createPipeline(repo, { name: "monthly BOOKKEEPING", stages: [{ name: "A" }, { name: "B", done: true }] }, "u", () => new Date("2027-01-01T00:00:00Z"));
    await assert.rejects(archivePipeline(repo, p.id, false), /already called/);

    const gone = await deletePipeline(repo, p.id);
    assert.equal(gone.id, p.id);
    assert.equal(await repo.get(p.id), null);
    await assert.rejects(deletePipeline(repo, p.id), /wasn't found/);
    // The default returns pipeline can be neither archived nor deleted.
    await assert.rejects(archivePipeline(repo, returns.id, true), /runs the Returns board/);
    await assert.rejects(deletePipeline(repo, returns.id), /Archive the pipeline first/);
  });
});

