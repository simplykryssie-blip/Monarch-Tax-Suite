import { randomUUID } from "node:crypto";
import type { CrmSecrets } from "../crm/crypto.ts";
import type { AddressAnswer, Answers } from "./answers.ts";
import type { FirmMap } from "./settings.ts";

// Turns a submission's answers into the firm record for My Service Bureau, using the form's field mapping.
// Identifiers are encrypted exactly as My Service Bureau encrypts them (same key, same associated data), so the
// firm's pages can show and edit them as if the firm had been added by hand.

export type FirmPayload = Record<string, unknown> & { org_id: string; legal_name: string };

const str = (a: Answers, key: string | null): string => {
  if (!key) return "";
  const v = a[key];
  return typeof v === "string" ? v.trim() : "";
};
const digits = (v: string) => v.replace(/\D/g, "");

export function firmAddress(a: AddressAnswer | undefined): Record<string, string> {
  if (!a) return {};
  return { line1: [a.line1, a.line2].filter(Boolean).join(", ").slice(0, 200), city: a.city, state: a.state, zip: a.zip };
}

/** The EFIN answered on the form (six digits), or null. */
export const efinFrom = (map: FirmMap, answers: Answers) => {
  const v = digits(str(answers, map.efin_key));
  return v.length === 6 ? v : null;
};

/**
 * The payload for `firm_from_submission`. `answers` must be the opened (decrypted) answers. Throws when the mapped
 * legal name or every mapped person is missing, because a firm needs both.
 */
export function buildFirmPayload(input: { map: FirmMap; answers: Answers; secrets: CrmSecrets; customerId: string | null; submissionId: string; number: number; formName: string }): FirmPayload {
  const { map, answers, secrets: s } = input;
  const legal = str(answers, map.legal_name_key).slice(0, 200);
  if (legal.length < 2) throw new Error("The firm's legal name was not answered, so no firm record was created.");
  const orgId = randomUUID();
  const ein = digits(str(answers, map.ein_key));
  const efin = efinFrom(map, answers);
  const address = map.address_key ? firmAddress(answers[map.address_key] as AddressAnswer | undefined) : {};
  const people = map.people
    .map((p) => {
      const name = str(answers, p.name_key).slice(0, 200);
      if (name.length < 2) return null;
      const ptin = str(answers, p.ptin_key).toUpperCase().replace(/[\s-]/g, "");
      const personId = randomUUID();
      const credId = /^P\d{8}$/.test(ptin) ? randomUUID() : null;
      return {
        person_id: personId,
        full_name: name,
        email: str(answers, p.email_key).toLowerCase().slice(0, 254) || null,
        phone: str(answers, p.phone_key).slice(0, 40) || null,
        role: p.role,
        cred_id: credId,
        ptin_encrypted: credId ? s.encrypt(ptin, `credential:${credId}:identifier`) : null,
        ptin_last4: credId ? ptin.slice(-4) : null,
        ptin_hash: credId ? s.hashIdentifier("ptin", ptin) : null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    // The ERO first, so the database makes them the firm's administrator.
    .sort((a, b) => Number(b.role === "ero") - Number(a.role === "ero"));
  if (!people.length) throw new Error("None of the firm's people were answered, so no firm record was created.");
  const efinId = efin ? randomUUID() : null;
  const dba = str(answers, map.dba_name_key).slice(0, 200);
  return {
    org_id: orgId,
    loc_id: randomUUID(),
    legal_name: legal,
    dba_name: dba || null,
    ein_encrypted: ein.length === 9 ? s.encrypt(ein, `org:${orgId}:ein`) : null,
    ein_last4: ein.length === 9 ? ein.slice(-4) : null,
    address,
    relationship: map.relationship,
    customer_id: input.customerId,
    office_name: (dba || legal).slice(0, 200),
    notes: `Created from "${input.formName}" submission #${input.number}.`.slice(0, 4000),
    submission_id: input.submissionId,
    actor_email: "form submission",
    people,
    efin: efinId && efin ? { efin_id: efinId, efin_encrypted: s.encrypt(efin, `efin:${efinId}:efin`), efin_last4: efin.slice(-4), efin_hash: s.hashIdentifier("efin", efin) } : null,
  };
}
