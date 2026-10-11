import "server-only";
import { automationDeps } from "./automation/server";
import { deriveProgress, inviteFacts } from "./automation/progress.ts";
import { commerceRepo } from "./admin";
import { crmDeps } from "./crm/server";
import type { OnboardingFacts } from "./commerce/installation-progress.ts";

/** A license's self-service setup state, as the installation next-step needs it. Null when the onboarding tables are unavailable. */
export async function loadOnboardingFacts(licenseId: string, nowMs = Date.now()): Promise<OnboardingFacts | null> {
  try {
    const auto = automationDeps();
    const [license, domains, connection, profile, events, links] = await Promise.all([
      commerceRepo().getLicense(licenseId), commerceRepo().listDomains(licenseId), crmDeps().repo.getLiveConnection(licenseId),
      auto.repo.getProfile(licenseId), auto.repo.listEventsByLicense(licenseId, 40), auto.repo.listLinksForLicense(licenseId, 10),
    ]);
    if (!license) return null;
    const executions = await auto.repo.listExecutionsForEvents(events.map((e) => e.id));
    const invite = inviteFacts(events, executions, links, nowMs);
    const conn = connection ? { provider: connection.provider, status: connection.status, last_checked_at: connection.last_checked_at, last_error: connection.last_error } : null;
    const progress = deriveProgress({ license, profile, domains, connection: conn, invite });
    return { completed: progress.status === "completed", remaining: progress.remaining.map((s) => s.label), invite: invite.status, linkState: invite.linkState, linkOpened: Boolean(invite.linkOpenedAt) };
  } catch {
    return null;
  }
}
