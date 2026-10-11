import Link from "next/link";
import { startCheckoutAction } from "@/app/shop/[slug]/actions";
import type { InstallationType } from "@/lib/commerce/types.ts";

const INSTALL_LABELS: Record<InstallationType, string> = {
  self_service: "I'll install it myself (setup guide included)",
  done_for_you: "Install it for me (done for you)",
};

/**
 * The storefront buy form. Checkout is always started by the server, which re-checks the product and its price;
 * the buyer must accept the current Terms and Refund Policy, and that acceptance is recorded on the order.
 */
export function BuyForm({ slug, installationOptions, licensed, error }: { slug: string; installationOptions: InstallationType[]; licensed: boolean; error?: string }) {
  return (
    <form action={startCheckoutAction} className="sf-buy">
      <input type="hidden" name="slug" value={slug} />
      {error && <p className="monarch-alert is-error" role="alert">{error}</p>}
      {licensed && installationOptions.length > 1 && (
        <fieldset>
          <legend>Installation</legend>
          {installationOptions.map((o, i) => (
            <label key={o}><input type="radio" name="installation_type" value={o} defaultChecked={i === 0} required /> {INSTALL_LABELS[o]}</label>
          ))}
        </fieldset>
      )}
      <label className="sf-accept">
        <input type="checkbox" name="accept_terms" value="yes" required /> I have read and accept the <Link href="/terms" target="_blank">Terms of Service</Link> and the <Link href="/refunds" target="_blank">Refund Policy</Link>.
      </label>
      <button type="submit">Purchase</button>
    </form>
  );
}
