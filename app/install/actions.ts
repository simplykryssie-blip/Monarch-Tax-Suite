"use server";

import { serviceClient } from "@/lib/supabase/service";
import { SupabaseCommerceRepo } from "@/lib/commerce/supabase-repo.ts";
import { submitIntake } from "@/lib/commerce/fulfillment.ts";
import { embedSnippet, embedUrl } from "@/lib/commerce/platforms.ts";
import { cleanNote, parseInstallationType, parsePlatform, ValidationError } from "@/lib/commerce/validation.ts";
import { appOrigin } from "@/lib/admin";
import { safeEmit } from "@/lib/automation/server";
import type { Platform } from "@/lib/commerce/types.ts";

export type IntakeState = {
  error?: string;
  done?: { platform: Platform; selfService: boolean; domain: string; snippet: string | null; url: string | null };
};

// Public action: authorization is the single-use, expiring token itself.
export async function submitIntakeAction(_prev: IntakeState, form: FormData): Promise<IntakeState> {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  try {
    const platform = parsePlatform(text("platform"));
    const result = await submitIntake(new SupabaseCommerceRepo(serviceClient()), text("token"), {
      platform,
      platform_other: cleanNote(text("platform_other"), 80),
      website_url: text("website_url"),
      domain: text("domain"),
      installation_type: parseInstallationType(text("installation_type")),
    });
    if (result.installation.license_id) {
      await safeEmit({ type: "installation.recorded", key: `installation:${result.installation.id}:recorded:${result.installation.intake_submitted_at}`, licenseId: result.installation.license_id, customerId: result.installation.customer_id, orderId: result.installation.order_id, data: {} });
    }
    const embedId = result.domainAuthorized ? result.license?.embed_id ?? null : null;
    const origin = await appOrigin();
    return {
      done: {
        platform,
        selfService: result.installation.installation_type === "self_service",
        domain: result.installation.target_location ?? "",
        snippet: embedId ? embedSnippet(origin, embedId) : null,
        url: embedId ? embedUrl(origin, embedId) : null,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
}
