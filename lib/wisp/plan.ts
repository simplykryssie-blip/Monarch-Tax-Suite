import type { WispAnswers } from "./content.ts";

// The written plan itself: the builder's answers expanded into the sections of a Written Information Security Plan,
// in full sentences. Everything specific to the firm comes from what the preparer entered; the rest is the standard
// policy language a WISP commits the firm to (IRS Publication 5708, Publication 4557 and the FTC Safeguards Rule).
// Where an answer says a safeguard isn't in place yet, the plan says so plainly and records it as a corrective
// action, never as done. No facts are invented.

export type PlanBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "note"; text: string }
  | { kind: "sign"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };
export type PlanSection = { title: string; blocks: PlanBlock[] };

const p = (text: string): PlanBlock => ({ kind: "p", text });
const h = (text: string): PlanBlock => ({ kind: "h", text });
const list = (items: string[], ordered = false): PlanBlock => ({ kind: "list", items, ordered });

/** A free-text answer as a sentence: trimmed, first letter up, ending in a full stop. */
export function sentence(raw: string | undefined): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const s = v.charAt(0).toUpperCase() + v.slice(1);
  return /[.!?…)"”]$/.test(s) ? s : `${s}.`;
}

/** A typed answer like "1. Contain… 2. Assess… 3. Notify" or one step per line, as separate steps; else null. */
export function steps(raw: string | undefined): string[] | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const byLine = v.split(/\r?\n+/).map((s) => s.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  if (byLine.length > 1) return byLine.map(sentence);
  const numbered = v.split(/(?:^|\s)\d+[.)]\s+/).map((s) => s.trim()).filter(Boolean);
  return numbered.length > 1 ? numbered.map(sentence) : null;
}

const count = (raw: string | undefined): number | null => {
  const n = Number.parseInt((raw ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function buildPlan(d: WispAnswers): PlanSection[] {
  const firm = d.firm_name?.trim() || "the Firm";
  const owner = d.owner_name?.trim() || "the Owner / Principal";
  const users = count(d.num_users);
  const software = d.tax_software?.trim();
  const mfa = d.mfa_status ?? "";
  const enc = d.encryption ?? "";
  const training = d.training ?? "";
  const review = d.review_date?.trim();
  const contact = d.ir_contact?.trim() || owner;

  const actions: string[] = [];
  if (/^No MFA/i.test(mfa)) actions.push("Turn on multi-factor authentication for every system that stores or reaches taxpayer information, starting with the tax software, email and remote access.");
  else if (/some/i.test(mfa)) actions.push("Extend multi-factor authentication to the systems that don't yet use it, so every system that stores or reaches taxpayer information requires it.");
  if (/^Not yet/i.test(enc)) actions.push("Encrypt taxpayer information both in transit and at rest: full-disk encryption on every computer and portable device, encrypted backups, and encrypted email or a secure portal for sending files.");
  else if (/in transit only/i.test(enc)) actions.push("Add encryption at rest: full-disk encryption on every computer and portable device that holds taxpayer information, and encrypted backups.");
  if (/^No formal/i.test(training)) actions.push("Hold the first documented security-awareness training for everyone with access, then repeat it at least once a year.");
  else if (/planned/i.test(training)) actions.push("Complete the planned security-awareness training, document attendance, and repeat it at least once a year.");

  const sections: PlanSection[] = [];

  sections.push({
    title: "Purpose and Scope",
    blocks: [
      p(`This Written Information Security Plan ("WISP" or "Plan") sets out how ${firm} (the "Firm") protects the confidentiality, integrity and availability of the taxpayer information it collects, uses, stores, transmits and disposes of in the course of preparing tax returns and providing related services.`),
      p("Tax return preparers are required to protect taxpayer data. The Gramm-Leach-Bliley Act and the Federal Trade Commission's Safeguards Rule (16 CFR Part 314) treat professional tax preparers as financial institutions that must keep a written information security program, and the IRS reminds preparers of this obligation in Publication 5708, Creating a Written Information Security Plan for your Tax & Accounting Practice, and Publication 4557, Safeguarding Taxpayer Data. This Plan is the Firm's written program."),
      p(`The Plan applies to all taxpayer and client information the Firm handles in any form, whether paper, electronic or spoken, and to every system, device, location and person that handles it. That includes the owner, employees, seasonal staff, contractors and any service provider given access. Everyone covered by the Plan is expected to read it, follow it and report anything that might put taxpayer information at risk.`),
      h("Objectives"),
      list([
        "Keep taxpayer information confidential and share it only with people who need it for their work.",
        "Protect against reasonably foreseeable threats to the security or integrity of that information.",
        "Protect against unauthorized access to or use of the information that could harm a client or lead to identity theft or refund fraud.",
        "Detect, respond to and recover from security incidents quickly, and meet every notification duty that applies.",
        "Keep the Plan current as the Firm's systems, staff and risks change.",
      ]),
    ],
  });

  const info: string[][] = [["Business name", firm], ["Owner / Principal", owner]];
  if (d.address?.trim()) info.push(["Business address", d.address.trim()]);
  if (d.phone?.trim()) info.push(["Business phone", d.phone.trim()]);
  if (d.business_email?.trim()) info.push(["Business email", d.business_email.trim()]);
  if (d.ein?.trim()) info.push(["EIN", d.ein.trim()]);
  if (users !== null) info.push(["People with access to taxpayer data", String(users)]);
  if (review) info.push(["Next scheduled review", review]);
  sections.push({
    title: "Firm Information and Responsibility",
    blocks: [
      { kind: "table", head: ["Item", "Details"], rows: info },
      h("Qualified Individual"),
      p(`The FTC Safeguards Rule requires the Firm to designate a Qualified Individual to oversee, implement and enforce its information security program. ${firm} designates ${owner} as the Qualified Individual. ${owner} is responsible for putting this Plan into practice, assessing risks, choosing and maintaining safeguards, overseeing service providers, training staff, leading the response to any security incident and reviewing the Plan on schedule.`),
      p(`${owner} may assign day-to-day tasks to others, but remains accountable for the program. At least once a year the Qualified Individual reviews the overall status of the program and its compliance with the Safeguards Rule, the results of the risk assessment, any security events and the Firm's response, and any recommended changes, and records that review with this Plan.`),
      h("Everyone's responsibilities"),
      p("Every person with access to taxpayer information must follow this Plan, use only the access they have been given, protect their passwords and devices, lock their screen and secure paper files when they step away, and report any suspected incident, lost device or suspicious message to the Qualified Individual immediately. Failing to follow the Plan may lead to loss of access and other disciplinary action."),
    ],
  });

  sections.push({
    title: "Definitions",
    blocks: [
      list([
        "Taxpayer information: any information the Firm obtains to prepare a return or provide a related service, including names, addresses, Social Security and Individual Taxpayer Identification Numbers, dates of birth, income and bank details, prior-year returns, identity documents and e-file credentials.",
        "Personally identifiable information (PII): information that can be used on its own or with other information to identify a specific person.",
        "Security incident: any event that compromises, or may compromise, the confidentiality, integrity or availability of taxpayer information or the systems that hold it. Examples include a lost or stolen device, a phishing compromise, malware or ransomware, unauthorized access, misdirected email, or a break-in.",
        "Service provider: any person or company outside the Firm that is given access to taxpayer information or the Firm's systems, such as the tax software provider, cloud storage, IT support or a shredding company.",
      ]),
    ],
  });

  sections.push({
    title: "Risk Assessment",
    blocks: [
      p("The Firm bases its safeguards on a written assessment of the reasonably foreseeable internal and external risks to taxpayer information. The assessment considers how and where information is collected, stored, used, sent and destroyed, and what could go wrong at each step."),
      p("The risks the Firm considers include phishing and social-engineering messages that try to steal credentials or install malware; stolen or weak passwords; ransomware; lost or stolen laptops, phones and storage devices; unauthorized access by current or former staff; unsecured Wi-Fi or remote access; misdirected email or unencrypted file transfers; break-ins or unattended paper files; failures of hardware, software or backups; and weaknesses at service providers."),
      p("For each risk the Firm considers how likely it is and how much harm it could cause, and whether its current safeguards are enough. The Qualified Individual repeats the assessment at least once a year, and again whenever the Firm adds a system, changes how it works, adds staff or a service provider, or has a security incident."),
      ...(actions.length
        ? [h("Corrective actions identified"), p("Based on the information recorded in this Plan, the following safeguards are not yet fully in place. The Firm commits to completing them and recording the date each is done:"), list(actions, true)]
        : [h("Current position"), p("Based on the information recorded in this Plan, the Firm reports multi-factor authentication on all systems, encryption in transit and at rest, and completed annual training. The Firm will continue to verify that these safeguards stay in place at each review.")]),
    ],
  });

  sections.push({
    title: "Information Inventory: Systems and Data",
    blocks: [
      p(`The Firm keeps an inventory of where taxpayer information lives so that each location can be protected, backed up and, when no longer needed, securely cleared. ${software ? `The Firm prepares and files returns using ${software}. Access to the tax software is limited to authorized staff, and its security settings are kept at the strongest level the provider offers.` : "The Firm records the tax software it uses in this inventory and keeps its security settings at the strongest level the provider offers."}`),
      ...(d.data_locations?.trim() ? [p(`The Firm reports that taxpayer data is stored in the following places: ${sentence(d.data_locations)} Each of these locations is covered by the access controls, encryption and physical safeguards in this Plan.`)] : []),
      p("When the Firm adds or retires a computer, device, cloud service or storage location, the Qualified Individual updates this inventory. Devices are recorded by type and user so that a lost or retired device can be identified and handled under this Plan."),
      h("Backup and recovery"),
      p(`${d.backup_method?.trim() ? `The Firm's backup method is: ${sentence(d.backup_method)} ` : ""}Backups protect against hardware failure, ransomware and accidental deletion. Backups that contain taxpayer information are protected with the same care as the original data: they are encrypted where possible, kept separate from the systems they protect so a single incident can't destroy both, and limited to authorized people. The Firm checks periodically that backups complete successfully and that files can actually be restored.`),
    ],
  });

  const accessBlocks: PlanBlock[] = [
    p(`Access to taxpayer information is limited to the people whose work requires it.${users !== null ? ` The Firm currently has ${users} ${users === 1 ? "person" : "people"} with access to taxpayer data.` : ""} Each person receives only the access needed for their role (least privilege), and every person uses their own individual account. Shared logins are not permitted, so that every action in the Firm's systems can be traced to one person.`),
  ];
  if (d.access_policy?.trim()) accessBlocks.push(p(`The Firm's access policy is as follows: ${sentence(d.access_policy)}`));
  accessBlocks.push(
    h("Granting and removing access"),
    p("Access is granted only after the Qualified Individual approves it and the person has read and acknowledged this Plan. When someone's role changes, their access is adjusted the same day. When someone leaves the Firm, or a seasonal engagement ends, all of their access is removed on or before their last day: accounts are disabled, passwords and shared codes they knew are changed, and keys, badges and Firm devices are returned. The Qualified Individual reviews the list of people with access at least once a year and at the start of each filing season."),
    h("Multi-factor authentication"),
    p(/^MFA on all/i.test(mfa)
      ? "The Firm reports that multi-factor authentication (MFA) is in use on all systems. MFA is required for the tax software, email, cloud storage, remote access and any other system that stores or reaches taxpayer information, as the FTC Safeguards Rule requires. MFA stays on for every account, and the methods used (an authenticator app or security key is preferred over text messages) are reviewed at each Plan review."
      : /some/i.test(mfa)
        ? "The Firm reports that multi-factor authentication (MFA) is in use on some of its systems. The FTC Safeguards Rule requires MFA for anyone accessing systems that hold customer information, so the Firm will extend MFA to every system that stores or reaches taxpayer information, including the tax software, email, cloud storage and remote access, and records this as a corrective action in the Risk Assessment."
        : "The Firm reports that multi-factor authentication (MFA) is not yet in place and will be implemented. The FTC Safeguards Rule requires MFA for anyone accessing systems that hold customer information. Until it is in place, the Firm treats this as its highest-priority corrective action, starting with the tax software, email and any remote access."),
    h("Passwords and sessions"),
    p("Every account uses a strong, unique password or passphrase of at least 12 characters that is not reused on any other site. Passwords are never shared, written where others can see them, or sent by email or text. A password manager is recommended. Default passwords on new devices and software are changed before use, and any password that may have been exposed is changed immediately. Computers lock automatically after a short period of inactivity and require a password to unlock."),
  );
  sections.push({ title: "Access Controls", blocks: accessBlocks });

  sections.push({
    title: "Safeguards",
    blocks: [
      h("Encryption"),
      p(/in transit and at rest/i.test(enc)
        ? "The Firm reports that taxpayer information is encrypted both in transit and at rest. Information sent outside the Firm travels over encrypted connections, such as a secure client portal, encrypted email or the tax software's own encrypted transmission, and is never sent as an unprotected attachment. Computers, portable devices and backups that hold taxpayer information use full-disk or file-level encryption, so the data stays protected if a device is lost or stolen."
        : /transit only/i.test(enc)
          ? "The Firm reports that taxpayer information is encrypted in transit. Information sent outside the Firm travels over encrypted connections, such as a secure client portal, encrypted email or the tax software's own encrypted transmission, and is never sent as an unprotected attachment. Encryption at rest is not yet in place on all devices, so the Firm will add full-disk encryption to every computer and portable device that holds taxpayer information, and encrypt its backups, as recorded in the Risk Assessment."
          : "The Firm reports that taxpayer information is not yet encrypted. The FTC Safeguards Rule requires encryption of customer information both in transit and at rest. The Firm will put encryption in place as a priority corrective action: encrypted connections or a secure portal for sending information, full-disk encryption on every computer and portable device, and encrypted backups. Until then, the Firm limits how taxpayer information is sent and where it is stored."),
      h("Physical security"),
      p(`${d.physical_security?.trim() ? `The Firm reports the following physical security measures: ${sentence(d.physical_security)} ` : ""}Paper records and devices that contain taxpayer information are kept in secured areas when not in use, and visitors are not left alone where client files or screens can be seen. Staff follow a clean-desk practice, putting files away and locking their screens whenever they step away. Laptops and portable devices are never left unattended in vehicles or public places.`),
      h("Network and device protections"),
      p("Every computer that handles taxpayer information runs supported, up-to-date operating systems and software, with security updates installed promptly, and uses security software that is kept current and set to scan automatically. The office network is protected by a firewall, and Wi-Fi uses strong encryption with a password that is not shared with clients or visitors; any guest network is kept separate. Public Wi-Fi is not used for taxpayer information unless the connection is protected by a trusted VPN. Remote access, where used, requires MFA."),
      p("Email is a common route for attacks. Staff check unexpected requests for information, password resets or payment changes through a separate, known contact method before acting, and never open attachments or links they did not expect. Client information is never sent by unencrypted email."),
      h("Service providers"),
      p(`The Firm selects service providers that can protect taxpayer information${software ? `, including its tax software provider, ${software}` : ""}, requires them by contract or terms of service to maintain appropriate safeguards, and periodically checks that they continue to do so. Providers receive only the access they need, and their access is removed when the relationship ends.`),
    ],
  });

  sections.push({
    title: "Employee Training and Awareness",
    blocks: [
      p(/^Annual training completed/i.test(training)
        ? "The Firm reports that annual security training has been completed. Everyone with access to taxpayer information receives security-awareness training before being given access and at least once a year after that, and the Firm keeps a record of who attended and when."
        : /planned/i.test(training)
          ? "The Firm reports that security training is planned. Everyone with access to taxpayer information will receive security-awareness training before being given access and at least once a year after that, and the Firm will keep a record of who attended and when. Completing the planned training is recorded as a corrective action in the Risk Assessment."
          : "The Firm reports that it has not yet held formal security training. Everyone with access to taxpayer information will receive security-awareness training before being given access and at least once a year after that, and the Firm will keep a record of who attended and when. Holding the first documented training is recorded as a corrective action in the Risk Assessment."),
      p("Training covers the requirements of this Plan; how to recognize phishing, pretext calls and other social-engineering attempts; password and MFA practices; safe handling, sending and disposal of taxpayer information; protecting devices in and out of the office; and how and when to report a suspected incident. The IRS's security awareness materials, including Publication 4557 and the Security Summit's \"Protect Your Clients; Protect Yourself\" campaign, are used as training resources."),
    ],
  });

  sections.push({
    title: "Data Retention and Disposal",
    blocks: [
      p("The Firm keeps taxpayer information only as long as it is needed for the services provided and as required by law, including the IRS requirement for preparers to keep a copy of each return or a list of returns prepared for at least three years. Information that is no longer needed is disposed of securely, and the Firm reviews its retention practice at each Plan review."),
      p("Paper records containing taxpayer information are cross-cut shredded or destroyed by a disposal company that provides a certificate of destruction. Electronic data is securely erased, and computers, drives, copiers and phones are wiped or physically destroyed before they are sold, recycled or discarded. Disposal of devices is recorded in the information inventory."),
    ],
  });

  const custom = steps(d.ir_steps);
  sections.push({
    title: "Incident Response Plan",
    blocks: [
      p(`This section sets out what the Firm does if taxpayer information may have been lost, stolen, exposed or accessed without authorization. The incident response contact is ${contact}. Anyone who suspects an incident reports it to ${contact} immediately, without trying to investigate on their own and without deleting anything.`),
      ...(custom
        ? [h("The Firm's response steps"), p("The Firm's own response steps, as recorded in this Plan, are:"), list(custom, true)]
        : d.ir_steps?.trim()
          ? [h("The Firm's response steps"), p(`The Firm's own response steps, as recorded in this Plan, are: ${sentence(d.ir_steps)}`)]
          : []),
      p("Those steps are carried out within the following framework."),
      h("1. Detect and report"),
      p("Signs of an incident include returns rejected because a return was already filed under a client's SSN, clients receiving IRS notices about returns they didn't file, unexpected e-file acknowledgments, a computer acting on its own, unexpected password-reset emails, a missing device or files, or a report from a client or provider. Any of these is reported to the incident response contact at once, with the time it was noticed and what was seen."),
      h("2. Contain"),
      p("The first priority is to stop further loss. Affected computers are disconnected from the network but not turned off or wiped, so evidence is preserved. Passwords for affected accounts are changed from a clean device, MFA is confirmed, and access by any compromised account or departed person is removed. A lost or stolen device is remotely locked or wiped if that is possible."),
      h("3. Assess"),
      p("The incident response contact works out what happened, which systems and records were involved, whose information was affected, whether that information was encrypted, and whether the threat is contained. The Firm brings in qualified IT or forensic help as needed and contacts its cyber or professional liability insurer, if it has one, early, since many policies require prompt notice. Everything found and done is written down with dates and times."),
      h("4. Notify"),
      p("The Firm makes every notification required by law and by its agreements, as soon as possible:"),
      list([
        "IRS: report the incident to the IRS Stakeholder Liaison for the Firm's area, without delay, so the IRS can help protect the affected clients' accounts. If the Firm's e-file credentials or EFIN may be compromised, also contact IRS e-Help.",
        "State tax agencies: notify the state tax agencies where affected clients file, for example through the Federation of Tax Administrators at StateAlert@taxadmin.org.",
        "FTC: if the unencrypted information of 500 or more consumers was acquired without authorization, notify the Federal Trade Commission as soon as possible and no later than 30 days after discovery, as the Safeguards Rule requires.",
        "State law: follow the data breach notification laws of each state where affected clients live, which may require notice to the clients and to the state attorney general within set deadlines.",
        "Law enforcement: report theft or criminal activity to local police and, for cybercrime, to the FBI's Internet Crime Complaint Center (IC3).",
        "Clients: tell affected clients what happened, what information was involved, what the Firm is doing, and what they can do, including how to request an Identity Protection PIN and, if they become victims of identity theft, how to file Form 14039.",
      ]),
      h("5. Recover and review"),
      p("Systems are cleaned or rebuilt and restored from known-good backups, and checked before they return to use. After the incident, the Qualified Individual reviews what happened and why, updates the risk assessment and this Plan, and arranges any extra training or safeguards needed so it doesn't happen again. The incident record is kept with this Plan."),
    ],
  });

  sections.push({
    title: "Plan Review and Maintenance",
    blocks: [
      p(`This Plan is reviewed at least once a year${review ? `, and the next scheduled review is ${review}` : ""}. It is also reviewed whenever the Firm's systems, services, staff, service providers or risks change significantly, and after any security incident. Each review checks that the safeguards described here are actually in place and working, records the status of any corrective actions, and updates the Plan where needed.`),
      p("The current version of the Plan is kept where everyone covered by it can read it, and earlier versions are kept for the Firm's records. Each person with access to taxpayer information acknowledges the Plan when they join and after any significant change."),
    ],
  });

  const ackRows = Array.from({ length: Math.min(Math.max(users ?? 5, 3), 25) }, () => ["", "", ""]);
  sections.push({
    title: "Adoption and Acknowledgment",
    blocks: [
      p(`${firm} adopts this Written Information Security Plan as its information security program and commits to carrying it out.`),
      { kind: "sign", lines: [`Signature of ${owner}, Owner / Principal and Qualified Individual`, "Date"] },
      h("Staff acknowledgment"),
      p("By signing below, each person confirms that they have read this Plan, understand their responsibilities under it, and agree to follow it."),
      { kind: "table", head: ["Name", "Signature", "Date"], rows: ackRows },
    ],
  });

  return sections;
}
