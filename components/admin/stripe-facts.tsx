import type { StripePriceFacts, StripeVerification } from "@/lib/commerce/types.ts";
import { when } from "./ui";

export type StripeConfigView = { secretKey: boolean; keyModeRecognized: boolean; mode: "live" | "test" | null; webhookSecret: boolean };

const money = (cents: number | null, currency: string) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`);

/** Server configuration status, without revealing any key. */
export function StripeConfigLine({ config }: { config: StripeConfigView }) {
  return (
    <p className="monarch-muted">
      Stripe key: {config.secretKey ? (config.keyModeRecognized ? `configured (${config.mode} mode)` : "set, but not a Stripe secret/restricted key") : "NOT configured"} · Webhook signing secret:{" "}
      {config.webhookSecret ? "configured" : "NOT configured"}
    </p>
  );
}

export function PriceFacts({ price }: { price: StripePriceFacts }) {
  return (
    <span>
      <code>{price.id}</code> · {money(price.unit_amount, price.currency)} · {price.type === "one_time" ? "one-time" : `recurring (${price.interval})`} · {price.active ? "active" : "archived"} ·{" "}
      {price.livemode ? "live" : "test"} mode{price.product_name ? ` · ${price.product_name}` : ""}
    </span>
  );
}

/** Shows what Stripe reported, clearly marked as verified, or the problems found. */
export function VerificationBlock({ v, emptyText = "Not verified with Stripe yet. The values above are catalog entries." }: { v: StripeVerification | null | undefined; emptyText?: string }) {
  if (!v) return <p className="monarch-muted"><b>UNVERIFIED</b> {emptyText}</p>;
  return (
    <div className={v.ok ? "sv-ok" : "sv-bad"}>
      <b>{v.ok ? "STRIPE-VERIFIED" : "STRIPE CHECK: ACTION NEEDED"}</b> · {v.mode} mode · checked {when(v.checked_at)}
      {v.product && <div>Product: <code>{v.product.id}</code> · {v.product.name} · {v.product.active ? "active" : "archived"}</div>}
      {v.price && <div>Price: <PriceFacts price={v.price} /></div>}
      {v.issues.length > 0 && <ul>{v.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}
