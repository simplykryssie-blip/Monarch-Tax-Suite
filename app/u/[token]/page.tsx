import type { Metadata } from "next";
import { ThemedPage } from "@/components/forms/themed-page";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { recipientByToken } from "@/lib/campaigns/public";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

const masked = (email: string) => email.replace(/^(.).*(@.*)$/, "$1•••$2");

/** The page behind the unsubscribe link in every campaign email. Nothing changes until the button is pressed. */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const found = await recipientByToken(token).catch(() => null);
  const brand = found ? await loadBrand(found.tenant_id).catch(() => null) : null;
  const theme = brandedTheme(DEFAULT_THEME, brand);
  const firm = brand?.name ?? "";
  if (!found || found.channel !== "email") {
    return <ThemedPage theme={theme} firm={firm}><h1>Link not valid</h1><p>This unsubscribe link isn&apos;t valid. Check that you copied the whole address from your email.</p></ThemedPage>;
  }
  const finished = done === "1" || found.unsubscribed_at !== null;
  return (
    <ThemedPage theme={theme} firm={firm}>
      <h1>{finished ? "You're unsubscribed" : "Unsubscribe"}</h1>
      {finished ? (
        <p>{masked(found.address)} will no longer get marketing emails from {firm || "this office"}. This only affects {firm || "this office"}; other businesses you hear from are not changed.</p>
      ) : (
        <>
          <p>Stop marketing emails from <strong>{firm || "this office"}</strong> to {masked(found.address)}?</p>
          <form method="post" action={`/u/${token}/one-click`}>
            <input type="hidden" name="confirm" value="1" />
            <button type="submit" className="monarch-primary">Unsubscribe</button>
          </form>
        </>
      )}
    </ThemedPage>
  );
}
