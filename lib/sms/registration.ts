import { ValidationError } from "../commerce/validation.ts";
import { isE164, toE164 } from "../automation/twilio.ts";
import type { NumberType } from "./pricing.ts";

// The guided carrier registration: everything the office tells us about itself and how its clients agree to texts.
// US carriers only deliver business texts from a verified (toll-free) or registered (local, A2P 10DLC) number. The
// office fills this in itself; the app submits it to Twilio once the setup payment is confirmed.

export const BUSINESS_TYPES = ["Sole Proprietorship", "Partnership", "Limited Liability Corporation", "Corporation", "Non-profit Corporation"] as const;
export const OPT_IN_TYPES = { WEB_FORM: "A form on our website or client portal", PAPER_FORM: "A signed paper form (engagement letter, intake sheet)", VERBAL: "They tell us in person or by phone", VIA_TEXT: "They text a keyword to our number" } as const;
export const VOLUMES = ["10", "100", "1,000", "10,000"] as const;
export const JOB_POSITIONS = ["Director", "GM", "VP", "CEO", "CFO", "General Counsel", "Other"] as const;

export type Registration = {
  legal_name: string;
  dba_name: string | null;
  business_type: (typeof BUSINESS_TYPES)[number];
  ein: string;
  website: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title: string;
  contact_position: (typeof JOB_POSITIONS)[number];
  opt_in_type: keyof typeof OPT_IN_TYPES;
  opt_in_description: string;
  /** A public image of where clients agree (a screenshot of the form), from the account's Images. */
  opt_in_image_url: string;
  sample_1: string;
  sample_2: string;
  monthly_volume: (typeof VOLUMES)[number];
};

/** Wording an office can keep or change. Every sample names the office and says how to opt out. */
export function suggestedRegistration(officeName: string): Partial<Registration> {
  const name = officeName || "our office";
  return {
    opt_in_type: "PAPER_FORM",
    opt_in_description: `Clients agree to receive text messages from ${name} by ticking "I agree to receive text messages about my tax return" on our signed client intake form. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.`,
    sample_1: `${name}: Hi Jane, your 2025 tax return was accepted by the IRS. Reply STOP to opt out.`,
    sample_2: `${name}: Hi Jane, we still need your W-2 to finish your return. Upload it at our client portal or reply with questions. Reply STOP to opt out.`,
    monthly_volume: "1,000",
    contact_position: "Director",
    business_type: "Limited Liability Corporation",
  };
}

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Checks the answers. Throws a ValidationError naming the first thing to fix. */
export function checkRegistration(raw: Record<string, unknown>, type: NumberType): Registration {
  const need = (k: string, label: string, max = 200) => {
    const v = line(raw[k], max);
    if (!v) throw new ValidationError(`Fill in ${label}.`);
    return v;
  };
  const legal_name = need("legal_name", "the legal business name (exactly as on your IRS EIN letter)", 120);
  const business_type = BUSINESS_TYPES.find((b) => b === raw.business_type);
  if (!business_type) throw new ValidationError("Choose the business type.");
  const ein = line(raw.ein, 20).replace(/\D/g, "");
  if (ein.length !== 9) throw new ValidationError("Enter the 9-digit EIN.");
  let website = line(raw.website, 300);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  try {
    const u = new URL(website);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) throw new Error();
  } catch {
    throw new ValidationError("Enter your business website, for example https://www.yourfirm.com. Carriers check that it is live.");
  }
  const state = need("state", "the state", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new ValidationError("Enter the state as two letters, for example LA.");
  const postal_code = need("postal_code", "the ZIP code", 10);
  if (!/^\d{5}(-\d{4})?$/.test(postal_code)) throw new ValidationError("Enter a 5-digit ZIP code.");
  const contact_email = need("contact_email", "the contact's email", 254).toLowerCase();
  if (!EMAIL.test(contact_email)) throw new ValidationError("Enter a valid contact email.");
  const contact_phone = toE164(line(raw.contact_phone, 30));
  if (!contact_phone || !isE164(contact_phone)) throw new ValidationError("Enter the contact's phone number, for example 337-555-0100.");
  const opt_in_type = (Object.keys(OPT_IN_TYPES) as (keyof typeof OPT_IN_TYPES)[]).find((k) => k === raw.opt_in_type);
  if (!opt_in_type) throw new ValidationError("Choose how clients agree to receive texts.");
  const opt_in_description = need("opt_in_description", "how clients agree to receive texts", 1000);
  if (opt_in_description.length < 40) throw new ValidationError("Describe how clients agree to texts in a sentence or two: where they agree and what they see.");
  const opt_in_image_url = line(raw.opt_in_image_url, 600);
  if (!/^https:\/\/[^\s"'<>]+$/.test(opt_in_image_url)) throw new ValidationError("Choose a picture that shows where clients agree to texts (for example a photo of your intake form's checkbox).");
  const sample = (k: "sample_1" | "sample_2", n: number) => {
    const v = need(k, `sample message ${n}`, 320);
    if (v.length < 20) throw new ValidationError(`Sample message ${n} is too short. Write a real message you would send.`);
    if (!/stop/i.test(v)) throw new ValidationError(`Sample message ${n} must say how to opt out, for example "Reply STOP to opt out."`);
    return v;
  };
  const sample_1 = sample("sample_1", 1);
  const sample_2 = type === "local" ? sample("sample_2", 2) : line(raw.sample_2, 320) || sample_1;
  const monthly_volume = VOLUMES.find((v) => v === raw.monthly_volume);
  if (!monthly_volume) throw new ValidationError("Choose about how many texts a month you expect.");
  const contact_position = JOB_POSITIONS.find((p) => p === raw.contact_position) ?? "Director";
  return {
    legal_name, dba_name: line(raw.dba_name, 120) || null, business_type, ein, website,
    street: need("street", "the street address", 200), city: need("city", "the city", 100), state, postal_code,
    contact_first_name: need("contact_first_name", "the contact's first name", 60), contact_last_name: need("contact_last_name", "the contact's last name", 60),
    contact_email, contact_phone, contact_title: line(raw.contact_title, 60) || "Owner", contact_position,
    opt_in_type, opt_in_description, opt_in_image_url, sample_1, sample_2, monthly_volume,
  };
}

/** The saved answers, if they are complete for this number type; null when something is missing. */
export function savedRegistration(raw: Record<string, unknown> | null | undefined, type: NumberType): Registration | null {
  try {
    return checkRegistration(raw ?? {}, type);
  } catch {
    return null;
  }
}
