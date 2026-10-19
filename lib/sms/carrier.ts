import type { TwilioApi } from "../automation/twilio.ts";
import type { Registration } from "./registration.ts";
import type { SmsRegistration } from "./types.ts";

// Carrier registration, submitted to Twilio as the office itself (its own API key, in its own subaccount):
// - toll-free: one toll-free verification (no campaign, ever);
// - local: the A2P 10DLC chain: a business profile (secondary customer profile, linked to the platform's primary
//   profile), an A2P profile, a brand, a messaging service with the number in it, then the campaign once the brand is
//   approved.
// Each step records the Twilio id it produced in `sids` as soon as it has it (in place, so the caller saves it even
// when a later step fails), and the next run carries on from where the last one stopped; nothing is submitted twice. Statuses are read back on each run (the daily sweep, or "Check status" in Settings).

const TRUSTHUB = "https://trusthub.twilio.com/v1";
const MESSAGING = "https://messaging.twilio.com/v1";
/** Twilio's policy ids: secondary customer profile (ISV), and A2P messaging profile. */
export const CUSTOMER_PROFILE_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
export const A2P_PROFILE_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

export type CarrierContext = {
  api: TwilioApi;
  tenantId: string;
  subaccountSid: string;
  phoneNumberSid: string;
  registration: Registration;
  /** The platform's own approved (primary) customer profile; every office's profile is linked to it. Local only. */
  primaryProfileSid: string | null;
  officeName: string;
};
export type CarrierResult = { sids: Record<string, string>; status: SmsRegistration; error: string | null; messagingServiceSid?: string | null };

const USE_CASE_SUMMARY = (r: Registration, office: string) =>
  `${office} is a tax preparation office. It texts its own clients who agreed to receive texts: updates on their tax return (documents needed, return filed, IRS acceptance), appointment reminders and replies to their questions. No marketing, no third-party content. ${r.opt_in_description}`.slice(0, 1000);

const tollFreeBusinessType = (t: Registration["business_type"]) => (t === "Non-profit Corporation" ? "NON_PROFIT" : t === "Sole Proprietorship" ? "SOLE_PROPRIETOR" : "PRIVATE_PROFIT");

// ---------------------------------------------------------------- toll-free

export async function advanceTollFree(c: CarrierContext, sids: Record<string, string>): Promise<CarrierResult> {
  const r = c.registration;
  const next = sids; // updated in place: the caller saves progress even if a later step fails
  if (!next.tollfree_verification) {
    const fields: [string, string][] = [
      ["TollfreePhoneNumberSid", c.phoneNumberSid],
      ["BusinessName", r.legal_name],
      ["BusinessWebsite", r.website],
      ["NotificationEmail", r.contact_email],
      ["UseCaseCategories", "ACCOUNT_NOTIFICATIONS"],
      ["UseCaseCategories", "CUSTOMER_CARE"],
      ["UseCaseSummary", USE_CASE_SUMMARY(r, c.officeName)],
      ["ProductionMessageSample", r.sample_1],
      ["OptInImageUrls", r.opt_in_image_url],
      ["OptInType", r.opt_in_type],
      ["MessageVolume", r.monthly_volume],
      ["BusinessStreetAddress", r.street],
      ["BusinessCity", r.city],
      ["BusinessStateProvinceRegion", r.state],
      ["BusinessPostalCode", r.postal_code],
      ["BusinessCountry", "US"],
      ["BusinessContactFirstName", r.contact_first_name],
      ["BusinessContactLastName", r.contact_last_name],
      ["BusinessContactEmail", r.contact_email],
      ["BusinessContactPhone", r.contact_phone],
      ["BusinessRegistrationNumber", r.ein],
      ["BusinessRegistrationAuthority", "EIN"],
      ["BusinessRegistrationCountry", "US"],
      ["BusinessType", tollFreeBusinessType(r.business_type)],
      ["AdditionalInformation", r.opt_in_description],
      ["ExternalReferenceId", c.tenantId],
      ...(r.dba_name ? [["DoingBusinessAs", r.dba_name] as [string, string]] : []),
    ];
    const v = await c.api.request<{ sid: string; status?: string }>("POST", `${MESSAGING}/Tollfree/Verifications`, fields);
    next.tollfree_verification = v.sid;
    return { sids: next, status: "submitted", error: null };
  }
  const v = await c.api.request<{ status?: string; rejection_reason?: string | null }>("GET", `${MESSAGING}/Tollfree/Verifications/${next.tollfree_verification}`);
  if (v.status === "TWILIO_APPROVED") return { sids: next, status: "approved", error: null };
  if (v.status === "TWILIO_REJECTED") return { sids: next, status: "rejected", error: (v.rejection_reason ?? "Carriers rejected the verification.").slice(0, 500) };
  return { sids: next, status: "submitted", error: null };
}

// ---------------------------------------------------------------- local (A2P 10DLC)

async function step(sids: Record<string, string>, key: string, run: () => Promise<string>): Promise<string> {
  if (!sids[key]) sids[key] = await run();
  return sids[key];
}

export async function advanceLocal(c: CarrierContext, sids: Record<string, string>): Promise<CarrierResult> {
  const r = c.registration;
  const next = sids; // updated in place: the caller saves progress even if a later step fails
  if (!c.primaryProfileSid) return { sids: next, status: "not_started", error: "Local numbers can't be registered yet: the platform's Twilio business profile isn't set up." };
  const api = c.api;
  const post = (url: string, fields: [string, string][]) => api.request<{ sid: string }>("POST", url, fields).then((x) => x.sid);

  // 1. The office's business profile (a secondary customer profile), with its details, representative and address.
  const profile = await step(next, "customer_profile", () => post(`${TRUSTHUB}/CustomerProfiles`, [["FriendlyName", r.legal_name.slice(0, 64)], ["Email", r.contact_email], ["PolicySid", CUSTOMER_PROFILE_POLICY]]));
  const business = await step(next, "business_info", () => post(`${TRUSTHUB}/EndUsers`, [["FriendlyName", `${r.legal_name} business`.slice(0, 64)], ["Type", "customer_profile_business_information"], ["Attributes", JSON.stringify({
    business_name: r.legal_name, business_identity: "direct_customer", business_type: r.business_type, business_industry: "FINANCIAL",
    business_registration_identifier: "EIN", business_registration_number: r.ein, business_regions_of_operation: "USA_AND_CANADA", website_url: r.website, social_media_profile_urls: "",
  })]]));
  const rep = await step(next, "representative", () => post(`${TRUSTHUB}/EndUsers`, [["FriendlyName", `${r.contact_first_name} ${r.contact_last_name}`.slice(0, 64)], ["Type", "authorized_representative_1"], ["Attributes", JSON.stringify({
    first_name: r.contact_first_name, last_name: r.contact_last_name, email: r.contact_email, phone_number: r.contact_phone, business_title: r.contact_title, job_position: r.contact_position,
  })]]));
  const address = await step(next, "address", () => post(`https://api.twilio.com/2010-04-01/Accounts/${c.subaccountSid}/Addresses.json`, [["CustomerName", r.legal_name], ["Street", r.street], ["City", r.city], ["Region", r.state], ["PostalCode", r.postal_code], ["IsoCountry", "US"]]));
  const addressDoc = await step(next, "address_document", () => post(`${TRUSTHUB}/SupportingDocuments`, [["FriendlyName", `${r.legal_name} address`.slice(0, 64)], ["Type", "customer_profile_address"], ["Attributes", JSON.stringify({ address_sids: address })]]));
  await step(next, "profile_assigned", async () => {
    for (const objectSid of [business, rep, addressDoc, c.primaryProfileSid!]) await post(`${TRUSTHUB}/CustomerProfiles/${profile}/EntityAssignments`, [["ObjectSid", objectSid]]);
    return "yes";
  });
  await step(next, "profile_submitted", async () => {
    await post(`${TRUSTHUB}/CustomerProfiles/${profile}/Evaluations`, [["PolicySid", CUSTOMER_PROFILE_POLICY]]);
    await post(`${TRUSTHUB}/CustomerProfiles/${profile}`, [["Status", "pending-review"]]);
    return "yes";
  });

  // 2. The A2P messaging profile.
  const a2p = await step(next, "a2p_profile", () => post(`${TRUSTHUB}/TrustProducts`, [["FriendlyName", `${r.legal_name} A2P`.slice(0, 64)], ["Email", r.contact_email], ["PolicySid", A2P_PROFILE_POLICY]]));
  const a2pInfo = await step(next, "a2p_info", () => post(`${TRUSTHUB}/EndUsers`, [["FriendlyName", `${r.legal_name} A2P info`.slice(0, 64)], ["Type", "us_a2p_messaging_profile_information"], ["Attributes", JSON.stringify({ company_type: r.business_type === "Non-profit Corporation" ? "non-profit" : "private" })]]));
  await step(next, "a2p_assigned", async () => {
    for (const objectSid of [a2pInfo, profile]) await post(`${TRUSTHUB}/TrustProducts/${a2p}/EntityAssignments`, [["ObjectSid", objectSid]]);
    return "yes";
  });
  await step(next, "a2p_submitted", async () => {
    await post(`${TRUSTHUB}/TrustProducts/${a2p}/Evaluations`, [["PolicySid", A2P_PROFILE_POLICY]]);
    await post(`${TRUSTHUB}/TrustProducts/${a2p}`, [["Status", "pending-review"]]);
    return "yes";
  });

  // 3. The brand, and a messaging service holding the number.
  const brand = await step(next, "brand", () => post(`${MESSAGING}/a2p/BrandRegistrations`, [["CustomerProfileBundleSid", profile], ["A2PProfileBundleSid", a2p]]));
  const service = await step(next, "messaging_service", () => post(`${MESSAGING}/Services`, [["FriendlyName", `${c.officeName} texts`.slice(0, 64)], ["UseInboundWebhookOnNumber", "true"]]));
  await step(next, "service_number", () => post(`${MESSAGING}/Services/${service}/PhoneNumbers`, [["PhoneNumberSid", c.phoneNumberSid]]));

  // 4. The campaign, once the brand is approved.
  if (!next.campaign) {
    const b = await api.request<{ status?: string; failure_reason?: string | null }>("GET", `${MESSAGING}/a2p/BrandRegistrations/${brand}`);
    if (b.status === "FAILED") return { sids: next, status: "rejected", error: (b.failure_reason ?? "Carriers rejected the brand registration.").slice(0, 500), messagingServiceSid: service };
    if (b.status !== "APPROVED") return { sids: next, status: "submitted", error: null, messagingServiceSid: service };
    next.campaign = await post(`${MESSAGING}/Services/${service}/Compliance/Usa2p`, [
      ["BrandRegistrationSid", brand],
      ["Description", USE_CASE_SUMMARY(r, c.officeName)],
      ["MessageFlow", r.opt_in_description],
      ["MessageSamples", r.sample_1],
      ["MessageSamples", r.sample_2],
      ["UsAppToPersonUsecase", "ACCOUNT_NOTIFICATION"],
      ["HasEmbeddedLinks", "true"],
      ["HasEmbeddedPhone", "true"],
      ["OptOutKeywords", "STOP"],
      ["HelpKeywords", "HELP"],
      ["OptOutMessage", `${c.officeName}: you won't get any more texts from us. Reply START to opt back in.`.slice(0, 160)],
      ["HelpMessage", `${c.officeName}: for help call ${r.contact_phone} or email ${r.contact_email}. Reply STOP to opt out.`.slice(0, 160)],
    ]);
    return { sids: next, status: "submitted", error: null, messagingServiceSid: service };
  }
  const camp = await api.request<{ campaign_status?: string; errors?: { description?: string }[] }>("GET", `${MESSAGING}/Services/${service}/Compliance/Usa2p/${next.campaign}`);
  if (camp.campaign_status === "VERIFIED") return { sids: next, status: "approved", error: null, messagingServiceSid: service };
  if (camp.campaign_status === "FAILED") return { sids: next, status: "rejected", error: (camp.errors?.[0]?.description ?? "Carriers rejected the campaign.").slice(0, 500), messagingServiceSid: service };
  return { sids: next, status: "submitted", error: null, messagingServiceSid: service };
}
