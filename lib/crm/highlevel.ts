// HighLevel (LeadConnector) API v2 client. Official endpoints only:
//   authorize: https://marketplace.gohighlevel.com/v2/oauth/chooselocation (the address GoHighLevel shows as the app's install link)
//   token:     POST https://services.leadconnectorhq.com/oauth/token (form-encoded)
//   API:       https://services.leadconnectorhq.com, header Version: 2021-07-28
// The HighLevel location chooser is where the buyer selects the sub-account.

export const HIGHLEVEL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/v2/oauth/chooselocation";
export const HIGHLEVEL_API = "https://services.leadconnectorhq.com";
export const HIGHLEVEL_VERSION = "2021-07-28";
/** Least privilege: create/find contacts, add tags and notes, read the connected location's name. */
export const HIGHLEVEL_SCOPES = ["contacts.readonly", "contacts.write", "locations.readonly"];

export type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  locationId: string | null;
  companyId: string | null;
};

export type ContactInput = { locationId: string; firstName: string; lastName?: string; email?: string; phone?: string; source: string };

/** Classified API failure. `kind` drives retry and reconnection behavior. */
export class HighLevelError extends Error {
  kind: "auth" | "retryable" | "permanent";
  status: number | null;
  constructor(message: string, kind: "auth" | "retryable" | "permanent", status: number | null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface HighLevelApi {
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  getLocation(token: string, locationId: string): Promise<{ id: string; name: string | null }>;
  findDuplicate(token: string, locationId: string, query: { email?: string; phone?: string }): Promise<string | null>;
  createContact(token: string, input: ContactInput): Promise<string>;
  upsertContact(token: string, input: ContactInput): Promise<{ id: string; created: boolean }>;
  addTags(token: string, contactId: string, tags: string[]): Promise<void>;
  addNote(token: string, contactId: string, body: string): Promise<void>;
}

/**
 * `versionId` is the app version shown in the install link's `version_id=`. GoHighLevel includes it while an app
 * version is not live yet (draft or in review); leave it unset once the app is live.
 */
export function authorizeUrl(clientId: string, redirectUri: string, state: string, versionId?: string): string {
  const url = new URL(HIGHLEVEL_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", HIGHLEVEL_SCOPES.join(" "));
  url.searchParams.set("state", state);
  if (versionId) url.searchParams.set("version_id", versionId);
  return url.toString();
}

type Json = Record<string, unknown>;

function classify(status: number, body: string, oauth = false): HighLevelError {
  const message = `HighLevel responded ${status}${body ? `: ${body.replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
  if (status === 401 || (oauth && (status === 400 || status === 403) && /invalid_grant|invalid_token|expired|revoked/i.test(body))) return new HighLevelError(message, "auth", status);
  if (status === 403) return new HighLevelError(message, "auth", status); // scope missing or app uninstalled
  if (status === 429 || status >= 500) return new HighLevelError(message, "retryable", status);
  return new HighLevelError(message, "permanent", status);
}

export class HttpHighLevelApi implements HighLevelApi {
  private clientId: string;
  private clientSecret: string;
  private fetchImpl: typeof fetch;
  constructor(clientId: string, clientSecret: string, fetchImpl: typeof fetch = fetch) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, init: RequestInit & { token?: string; oauth?: boolean }): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${HIGHLEVEL_API}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.token ? { Authorization: `Bearer ${init.token}`, Version: HIGHLEVEL_VERSION } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new HighLevelError(`HighLevel request failed: ${e instanceof Error ? e.message : "network error"}`, "retryable", null);
    }
    const text = await res.text();
    if (!res.ok) throw classify(res.status, text, init.oauth);
    try {
      return text ? (JSON.parse(text) as Json) : {};
    } catch {
      throw new HighLevelError("HighLevel returned an unreadable response.", "retryable", res.status);
    }
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...params });
    const data = await this.request("/oauth/token", { method: "POST", body, oauth: true, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") throw new HighLevelError("HighLevel did not return tokens.", "permanent", null);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
      scope: typeof data.scope === "string" ? data.scope : "",
      userType: typeof data.userType === "string" ? data.userType : "",
      locationId: typeof data.locationId === "string" ? data.locationId : null,
      companyId: typeof data.companyId === "string" ? data.companyId : null,
    };
  }

  exchangeCode(code: string, redirectUri: string) {
    return this.token({ grant_type: "authorization_code", code, user_type: "Location", redirect_uri: redirectUri });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken, user_type: "Location" });
  }

  async getLocation(token: string, locationId: string) {
    const data = await this.request(`/locations/${encodeURIComponent(locationId)}`, { method: "GET", token });
    const loc = (data.location ?? data) as Json;
    return { id: String(loc.id ?? loc._id ?? locationId), name: typeof loc.name === "string" ? loc.name : null };
  }

  async findDuplicate(token: string, locationId: string, query: { email?: string; phone?: string }) {
    const params = new URLSearchParams({ locationId });
    if (query.email) params.set("email", query.email);
    if (query.phone) params.set("number", query.phone);
    const data = await this.request(`/contacts/search/duplicate?${params}`, { method: "GET", token });
    const contact = (data.contact ?? (Array.isArray(data.contacts) ? data.contacts[0] : null)) as Json | null;
    return contact && typeof contact.id === "string" ? contact.id : null;
  }

  private contactBody(input: ContactInput) {
    const body: Json = { locationId: input.locationId, firstName: input.firstName, source: input.source };
    if (input.lastName) body.lastName = input.lastName;
    if (input.email) body.email = input.email;
    if (input.phone) body.phone = input.phone;
    return JSON.stringify(body);
  }

  async createContact(token: string, input: ContactInput) {
    const data = await this.request("/contacts/", { method: "POST", token, body: this.contactBody(input), headers: { "Content-Type": "application/json" } });
    const id = (data.contact as Json | undefined)?.id;
    if (typeof id !== "string") throw new HighLevelError("HighLevel did not return a contact id.", "retryable", null);
    return id;
  }

  async upsertContact(token: string, input: ContactInput) {
    // Tags are deliberately not sent here: upsert overwrites all existing tags.
    const data = await this.request("/contacts/upsert", { method: "POST", token, body: this.contactBody(input), headers: { "Content-Type": "application/json" } });
    const id = (data.contact as Json | undefined)?.id;
    if (typeof id !== "string") throw new HighLevelError("HighLevel did not return a contact id.", "retryable", null);
    return { id, created: data.new === true };
  }

  async addTags(token: string, contactId: string, tags: string[]) {
    await this.request(`/contacts/${encodeURIComponent(contactId)}/tags`, { method: "POST", token, body: JSON.stringify({ tags }), headers: { "Content-Type": "application/json" } });
  }

  async addNote(token: string, contactId: string, body: string) {
    await this.request(`/contacts/${encodeURIComponent(contactId)}/notes`, { method: "POST", token, body: JSON.stringify({ body }), headers: { "Content-Type": "application/json" } });
  }
}
