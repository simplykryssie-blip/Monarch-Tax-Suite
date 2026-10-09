import { randomUUID } from "node:crypto";
import { HighLevelError, type ContactInput, type HighLevelApi, type TokenSet } from "../lib/crm/highlevel.ts";
import type { CrmConnection, CrmRepo, DeliveryLogEntry, LeadSettings, NewConnection } from "../lib/crm/types.ts";

// In-memory CrmRepo enforcing the migration's rules: one live connection per
// license, single-use OAuth states, credentials cleared on disconnect.
export class MemoryCrmRepo implements CrmRepo {
  states: { state_hash: string; license_id: string; expires_at: string; used_at: string | null }[] = [];
  connections: CrmConnection[] = [];
  settings: LeadSettings[] = [];
  log: DeliveryLogEntry[] = [];
  private clone = <T>(v: T): T => structuredClone(v);
  private ts = () => new Date().toISOString();

  async createOAuthState(input: { state_hash: string; license_id: string; expires_at: string }) { this.states.push({ ...input, used_at: null }); }
  async consumeOAuthState(hash: string, now: string) {
    const s = this.states.find((x) => x.state_hash === hash && !x.used_at && x.expires_at > now);
    if (!s) return null;
    s.used_at = now;
    return s.license_id;
  }
  async getLiveConnection(licenseId: string) { return this.clone(this.connections.find((c) => c.license_id === licenseId && c.status !== "disconnected") ?? null); }
  async getConnection(id: string) { return this.clone(this.connections.find((c) => c.id === id) ?? null); }
  async insertConnection(input: NewConnection) {
    if (this.connections.some((c) => c.license_id === input.license_id && c.status !== "disconnected")) throw new Error("unique violation: one live connection");
    const row: CrmConnection = {
      location_id: null, location_name: null, company_id: null, scopes: [], access_token_enc: null, refresh_token_enc: null, token_expires_at: null,
      webhook_url_enc: null, webhook_host: null, signing_secret_enc: null, last_checked_at: null,
      ...input, id: randomUUID(), refresh_lock_until: null, last_refresh_at: null, last_success_at: null, last_error: null, last_error_at: null,
      connected_at: this.ts(), disconnected_at: null, created_at: this.ts(), updated_at: this.ts(),
    };
    this.connections.push(row);
    return this.clone(row);
  }
  async updateConnection(id: string, patch: Partial<CrmConnection>) {
    const row = this.connections.find((c) => c.id === id)!;
    Object.assign(row, patch, { updated_at: this.ts() });
    if (row.status === "disconnected" && (row.access_token_enc || row.refresh_token_enc || row.webhook_url_enc || row.signing_secret_enc)) throw new Error("check violation: credentials on disconnected");
    return this.clone(row);
  }
  async claimRefreshLock(id: string, until: string, now: string) {
    const row = this.connections.find((c) => c.id === id);
    if (!row || row.status !== "connected" || (row.refresh_lock_until && row.refresh_lock_until >= now)) return false;
    row.refresh_lock_until = until;
    return true;
  }
  async getLeadSettings(licenseId: string) { return this.clone(this.settings.find((s) => s.license_id === licenseId) ?? null); }
  async saveLeadSettings(input: Omit<LeadSettings, "updated_at">) {
    this.settings = this.settings.filter((s) => s.license_id !== input.license_id);
    const row = { ...input, updated_at: this.ts() };
    this.settings.push(row);
    return this.clone(row);
  }
  async logDelivery(entry: Omit<DeliveryLogEntry, "id" | "created_at">) { this.log.push({ ...entry, id: randomUUID(), created_at: this.ts() }); }
  async countDeliveries(filter: { license_id?: string; ip_hash?: string }, since: string) {
    return this.log.filter((l) => l.created_at >= since && (!filter.license_id || l.license_id === filter.license_id) && (!filter.ip_hash || l.ip_hash === filter.ip_hash)).length;
  }
  async listDeliveries(licenseId: string, limit: number) { return this.clone(this.log.filter((l) => l.license_id === licenseId).slice(-limit).reverse()); }
  async pruneDeliveryLog(ipBefore: string, deleteBefore: string) {
    for (const l of this.log) if (l.created_at < ipBefore) l.ip_hash = null;
    this.log = this.log.filter((l) => l.created_at >= deleteBefore);
  }
}

type FakeContact = { id: string; locationId: string; firstName: string; lastName?: string; email?: string; phone?: string; source: string; tags: string[]; notes: string[] };

/**
 * Fake HighLevel with independent accounts/locations. Each OAuth code is tied
 * to one location; tokens are only valid for their own location.
 */
export class FakeHighLevel implements HighLevelApi {
  contacts: FakeContact[] = [];
  codes = new Map<string, { locationId: string; userType?: string }>();
  locations = new Map<string, string>();
  private tokens = new Map<string, { locationId: string; expired?: boolean }>();
  private refreshTokens = new Map<string, string>(); // refresh -> locationId (single use)
  calls: string[] = [];
  /** Queue of failures to inject: next matching call throws. */
  failures: { op: string; error: HighLevelError }[] = [];
  refreshRevoked = new Set<string>();
  private n = 0;

  addLocation(id: string, name: string) { this.locations.set(id, name); }
  issueCode(locationId: string, userType = "Location") {
    const code = `code_${++this.n}`;
    this.codes.set(code, { locationId, userType });
    return code;
  }
  expireAccessTokens(locationId: string) { for (const t of this.tokens.values()) if (t.locationId === locationId) t.expired = true; }
  revoke(locationId: string) {
    this.expireAccessTokens(locationId);
    this.refreshRevoked.add(locationId);
  }
  private maybeFail(op: string) {
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) throw this.failures.splice(i, 1)[0].error;
  }
  private mint(locationId: string, userType = "Location"): TokenSet {
    const access = `at_${++this.n}`;
    const refresh = `rt_${++this.n}`;
    this.tokens.set(access, { locationId });
    this.refreshTokens.set(refresh, locationId);
    return { access_token: access, refresh_token: refresh, expires_in: 86399, scope: "contacts.readonly contacts.write locations.readonly", userType, locationId: userType === "Location" ? locationId : null, companyId: "comp_1" };
  }
  private auth(token: string, locationId: string) {
    const t = this.tokens.get(token);
    if (!t || t.expired) throw new HighLevelError("HighLevel responded 401", "auth", 401);
    if (t.locationId !== locationId) throw new HighLevelError("HighLevel responded 403: token not authorized for this location", "auth", 403);
  }
  async exchangeCode(code: string) {
    this.calls.push("exchangeCode");
    const c = this.codes.get(code);
    if (!c) throw new HighLevelError("HighLevel responded 400: invalid_grant", "auth", 400);
    this.codes.delete(code);
    return this.mint(c.locationId, c.userType);
  }
  async refresh(refreshToken: string) {
    this.calls.push("refresh");
    this.maybeFail("refresh");
    const loc = this.refreshTokens.get(refreshToken);
    if (!loc || this.refreshRevoked.has(loc)) throw new HighLevelError("HighLevel responded 400: invalid_grant", "auth", 400);
    this.refreshTokens.delete(refreshToken); // single use
    return this.mint(loc);
  }
  async getLocation(token: string, locationId: string) {
    this.calls.push("getLocation");
    this.auth(token, locationId);
    return { id: locationId, name: this.locations.get(locationId) ?? null };
  }
  async findDuplicate(token: string, locationId: string, q: { email?: string; phone?: string }) {
    this.calls.push("findDuplicate");
    this.auth(token, locationId);
    return this.contacts.find((c) => c.locationId === locationId && ((q.email && c.email === q.email) || (q.phone && c.phone === q.phone)))?.id ?? null;
  }
  async createContact(token: string, input: ContactInput) {
    this.calls.push("createContact");
    this.auth(token, input.locationId);
    this.maybeFail("createContact");
    const id = `ct_${++this.n}`;
    this.contacts.push({ ...input, id, tags: [], notes: [] });
    return id;
  }
  async upsertContact(token: string, input: ContactInput) {
    this.calls.push("upsertContact");
    this.auth(token, input.locationId);
    const existing = this.contacts.find((c) => c.locationId === input.locationId && ((input.email && c.email === input.email) || (input.phone && c.phone === input.phone)));
    if (existing) {
      Object.assign(existing, { firstName: input.firstName, lastName: input.lastName ?? existing.lastName, email: input.email ?? existing.email, phone: input.phone ?? existing.phone });
      return { id: existing.id, created: false };
    }
    return { id: await this.createContact(token, input), created: true };
  }
  private contact(token: string, id: string) {
    const c = this.contacts.find((x) => x.id === id);
    if (!c) throw new HighLevelError("HighLevel responded 404", "permanent", 404);
    this.auth(token, c.locationId);
    return c;
  }
  async addTags(token: string, contactId: string, tags: string[]) {
    this.calls.push("addTags");
    this.maybeFail("addTags");
    const c = this.contact(token, contactId);
    c.tags = [...new Set([...c.tags, ...tags])];
  }
  async addNote(token: string, contactId: string, body: string) {
    this.calls.push("addNote");
    this.maybeFail("addNote");
    this.contact(token, contactId).notes.push(body);
  }
}
