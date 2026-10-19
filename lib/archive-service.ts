import { ValidationError } from "./commerce/validation.ts";
import {
  archiveProblem, cleanReason, ENTITY, hardDeleteProblem, recordLabel, restoredStatus, STATUS_ARCHIVED,
  type ArchiveEntity, type ArchiveFacts, type ArchiveLogEntry, type ArchiveLogRow, type ArchiveRow,
} from "./archive.ts";

// Archive, restore and hard delete for any of the platform's archivable records, for one tenant. The store does the
// reads and writes (the database's tenant policies keep it to the signed-in tenant); this applies the rules and writes
// one history entry for every change.

export type ArchiveStore = {
  get(entity: ArchiveEntity, id: string): Promise<ArchiveRow | null>;
  facts(entity: ArchiveEntity, row: ArchiveRow): Promise<ArchiveFacts>;
  update(entity: ArchiveEntity, id: string, patch: Record<string, unknown>): Promise<void>;
  /** Deletes the record and anything that belongs only to it (for example a document's files). */
  remove(entity: ArchiveEntity, row: ArchiveRow): Promise<void>;
  log(entry: ArchiveLogEntry): Promise<void>;
  history(entity: ArchiveEntity, id: string): Promise<ArchiveLogRow[]>;
  isOwner(userId: string): Promise<boolean>;
  now?: () => Date;
};

async function mustGet(store: ArchiveStore, entity: ArchiveEntity, id: string) {
  const row = await store.get(entity, id);
  if (!row) throw new ValidationError(`That ${ENTITY[entity].noun} was not found.`);
  return row;
}

export async function archiveRecord(store: ArchiveStore, entity: ArchiveEntity, id: string, actorId: string, reasonRaw?: unknown): Promise<void> {
  const row = await mustGet(store, entity, id);
  const facts = await store.facts(entity, row);
  const problem = archiveProblem(entity, row, facts);
  if (problem) throw new ValidationError(problem);
  const reason = cleanReason(reasonRaw);
  const patch: Record<string, unknown> = { archived_at: (store.now?.() ?? new Date()).toISOString(), archived_by: actorId, archive_reason: reason };
  if (STATUS_ARCHIVED.has(entity)) patch.status = "archived";
  await store.update(entity, id, patch);
  await store.log({ entity, record_id: id, action: "archived", actor_id: actorId, label: recordLabel(entity, row, facts), reason });
}

export async function restoreRecord(store: ArchiveStore, entity: ArchiveEntity, id: string, actorId: string | null, opts: { auto?: boolean; reason?: string } = {}): Promise<void> {
  const row = await mustGet(store, entity, id);
  if (!row.archived_at) throw new ValidationError(`This ${ENTITY[entity].noun} isn't archived.`);
  const patch: Record<string, unknown> = { archived_at: null, archived_by: null, archive_reason: null };
  const status = restoredStatus(entity, row);
  if (status) patch.status = status;
  await store.update(entity, id, patch);
  await store.log({ entity, record_id: id, action: opts.auto ? "auto_restored" : "restored", actor_id: actorId, label: recordLabel(entity, row, await store.facts(entity, row)), reason: cleanReason(opts.reason) });
}

export async function hardDeleteRecord(store: ArchiveStore, entity: ArchiveEntity, id: string, actorId: string, confirm: string): Promise<void> {
  const row = await mustGet(store, entity, id);
  const facts = await store.facts(entity, row);
  const problem = hardDeleteProblem(entity, row, facts, { isOwner: await store.isOwner(actorId), confirm });
  if (problem) throw new ValidationError(problem);
  const label = recordLabel(entity, row, facts);
  await store.remove(entity, row);
  await store.log({ entity, record_id: id, action: "deleted", actor_id: actorId, label, reason: row.archive_reason ?? null });
}

/** A customer who buys again with the same email comes back from the archive, and the history says why. */
export async function restoreCustomerOnPurchase(store: Pick<ArchiveStore, "update" | "log">, customer: ArchiveRow, why: string): Promise<void> {
  if (!customer.archived_at) return;
  await store.update("customer", customer.id, { archived_at: null, archived_by: null, archive_reason: null });
  await store.log({ entity: "customer", record_id: customer.id, action: "auto_restored", actor_id: null, label: recordLabel("customer", customer), reason: cleanReason(why) });
}
