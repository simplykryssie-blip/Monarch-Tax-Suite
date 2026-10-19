import type { CommerceRepo, Installation, License } from "./types.ts";

// Installation states follow what actually happened, so an installation never sits at "requested" while the customer
// is setting up or the calculator is already live:
//  - setup_started:   a self-service customer opened their setup link or saved their details → in_progress
//  - setup_completed: a self-service customer finished every setup step                         → in_progress (noted)
//  - seen_live:       the calculator loaded inside an authorized website (license checked)      → active
// Every change is recorded as an installation event. Nothing moves backwards, and active or removed installations,
// and blocked ones (an administrator decision), are left alone.

export type InstallationSignal = { kind: "setup_started" } | { kind: "setup_completed" } | { kind: "seen_live"; host: string };

const NOTES: Record<InstallationSignal["kind"], string> = {
  setup_started: "Customer started self-service setup.",
  setup_completed: "Customer finished self-service setup (details, authorized website, tested CRM). It turns active when the calculator first loads on the authorized website.",
  seen_live: "Calculator loaded live on the authorized website",
};

/** Applies one signal to a license's installation. Returns the installation when its status changed, else null. Idempotent. */
export async function advanceInstallation(repo: CommerceRepo, licenseId: string, signal: InstallationSignal): Promise<Installation | null> {
  const license = await repo.getLicense(licenseId);
  if (!license) return null;
  const installation = await repo.findInstallationByOrder(license.order_id);
  if (!installation || installation.status === "active" || installation.status === "removed" || installation.status === "blocked") return null;

  let to: Installation["status"] | null = null;
  if (signal.kind === "seen_live") {
    const order = await repo.getOrder(installation.order_id);
    if (license.status === "active" && order?.payment_status === "paid") to = "active";
  } else if (installation.installation_type === "self_service") {
    if (installation.status === "requested") to = "in_progress";
    else if (signal.kind === "setup_completed" && installation.status === "in_progress") {
      // Already in progress: record that setup finished, once.
      const events = await repo.listInstallationEvents(installation.id);
      if (!events.some((e) => e.note === NOTES.setup_completed)) await repo.addInstallationEvent({ installation_id: installation.id, from_status: null, to_status: null, note: NOTES.setup_completed, actor_id: null });
      return null;
    }
  }
  if (!to) return null;
  const updated = await repo.updateInstallation(installation.id, { status: to });
  const note = signal.kind === "seen_live" ? `${NOTES.seen_live} (${signal.host.slice(0, 120)}).` : NOTES[signal.kind];
  await repo.addInstallationEvent({ installation_id: installation.id, from_status: installation.status, to_status: to, note, actor_id: null });
  return updated;
}

export type OnboardingFacts = {
  completed: boolean;
  remaining: string[];
  invite: "none" | "sent" | "sending" | "failed";
  linkState: "none" | "active" | "expired" | "revoked";
  linkOpened: boolean;
};

/** What the installation is waiting for and the one action that moves it forward. Pure, so every page agrees. */
export function installationNextStep(input: {
  installation: Pick<Installation, "status" | "installation_type" | "platform" | "target_location" | "intake_submitted_at" | "intake_expires_at">;
  license: Pick<License, "status" | "key_prefix"> | null;
  activeDomains: string[];
  onboarding: OnboardingFacts | null;
}): { waitingOn: "nobody" | "administrator" | "customer"; text: string } {
  const { installation: i, license, onboarding } = input;
  const site = input.activeDomains[0] ?? i.target_location ?? "the authorized website";
  if (i.status === "active") return { waitingOn: "nobody", text: "Live: the calculator has loaded on the authorized website." };
  if (i.status === "removed") return { waitingOn: "nobody", text: "Removed. Nothing to do." };
  if (i.status === "blocked") return { waitingOn: "administrator", text: "Blocked: read the latest note, resolve it, then set the status back to In progress." };
  if (!license || license.status === "pending" || !license.key_prefix) return { waitingOn: "administrator", text: "Issue the license key on the License page. Setup cannot finish until the license is active." };
  if (license.status !== "active") return { waitingOn: "administrator", text: `The license is ${license.status}, so the calculator is blocked. Reactivate the license to continue.` };

  if (i.installation_type === "self_service") {
    if (!onboarding) return { waitingOn: "administrator", text: "Onboarding records are unavailable. Check the Customer onboarding panel on the License page." };
    if (onboarding.completed) {
      return { waitingOn: "customer", text: `Setup is finished. Waiting for the calculator to load on ${site}; it turns active automatically. If it does not, ask the customer to check the code is on that website.` };
    }
    if (onboarding.invite === "none") return { waitingOn: "administrator", text: "Send the setup email (License page → Customer onboarding)." };
    if (onboarding.invite === "failed") return { waitingOn: "administrator", text: "The setup email failed. Fix the reason shown in Customer onboarding, then resend it." };
    if (onboarding.linkState === "expired" || onboarding.linkState === "revoked") return { waitingOn: "administrator", text: "The setup link is no longer valid. Resend the setup email." };
    if (!onboarding.linkOpened) return { waitingOn: "customer", text: "Waiting for the customer to open the setup email. Resend it if they cannot find it." };
    return { waitingOn: "customer", text: `The customer is setting up. Remaining: ${onboarding.remaining.join(", ").toLowerCase() || "finish setup"}.` };
  }

  // Done for you
  if (i.status === "requested") {
    if (!i.intake_submitted_at && (i.platform === "other" || !i.target_location)) {
      return i.intake_expires_at
        ? { waitingOn: "customer", text: "Waiting for the customer to send their installation details from the link." }
        : { waitingOn: "administrator", text: "Send the customer an installation details link (button below)." };
    }
    return { waitingOn: "administrator", text: `Install the calculator on ${site}, then set the status to In progress.` };
  }
  return { waitingOn: "administrator", text: `Finish the installation on ${site}. It turns active automatically when the calculator first loads there, or set it to Active.` };
}
