import "server-only";
import { commerceRepo } from "./admin";
import { safeEmit } from "./automation/server";
import { advanceInstallation, type InstallationSignal } from "./commerce/installation-progress.ts";

/**
 * Moves a license's installation forward from what the customer actually did. Never throws: a failure here must not
 * break setup or the calculator. A done-for-you installation that goes live sends the usual completion notice.
 */
export async function noteInstallation(licenseId: string, signal: InstallationSignal): Promise<void> {
  try {
    const updated = await advanceInstallation(commerceRepo(), licenseId, signal);
    if (updated?.status === "active" && updated.installation_type === "done_for_you") {
      await safeEmit({ type: "installation.verified", key: `installation:${updated.id}:verified:${updated.updated_at}`, licenseId, customerId: updated.customer_id, orderId: updated.order_id, data: {} });
    }
  } catch (e) {
    console.error(`installation ${signal.kind} for ${licenseId} not recorded: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }
}
