import { createStripePriceAction, createStripeProductAction, syncStripeProductInfoAction } from "@/app/(admin)/product-actions";
import { priceSyncState } from "@/lib/commerce/stripe-sync.ts";
import type { Product } from "@/lib/commerce/types.ts";
import { money, when } from "./ui";

const PRICE_STATE: Record<ReturnType<typeof priceSyncState>, string> = {
  no_stripe_price: "No Stripe price linked.",
  in_sync: "The linked Stripe price charges the catalog price.",
  unverified: "Linked by hand; its amount has not been confirmed through a sync.",
  differs: "The catalog price differs from the linked Stripe price. Customers are charged the Stripe price until a new price is created.",
};

function Action({ action, id, label, confirm, disabled }: { action: (f: FormData) => Promise<void>; id: string; label: string; confirm?: string; disabled?: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="monarch-secondary" type="submit" disabled={disabled} title={confirm}>{label}</button>
    </form>
  );
}

/** Explicit Stripe operations, each a separate button with its result recorded. */
export function StripePanel({ product, stripeConfigured }: { product: Product; stripeConfigured: boolean }) {
  const state = priceSyncState(product);
  const archived = product.status === "archived";
  const off = !stripeConfigured || archived;
  return (
    <section className="monarch-panel monarch-pad">
      <h2 className="monarch-h2">Stripe</h2>
      <p className="monarch-muted">
        Saving the product never changes Stripe. These actions run only when clicked. Stripe prices cannot be edited: a price change creates a
        new price, and existing prices, payment links and completed payments stay as they are. Order history is never rewritten.
      </p>
      {!stripeConfigured && <div className="monarch-notice"><b>STRIPE NOT CONNECTED</b> STRIPE_SECRET_KEY is not configured on the server, so Stripe actions are disabled.</div>}
      <dl className="monarch-dl">
        <dt>Stripe product</dt><dd>{product.stripe_product_id ? <code>{product.stripe_product_id}</code> : "Not linked"}</dd>
        <dt>Stripe price</dt>
        <dd>
          {product.stripe_price_id ? <code>{product.stripe_price_id}</code> : "Not linked"}
          {product.stripe_price_cents !== null && <> · {money(product.stripe_price_cents, product.currency)}</>}
          <small className="monarch-subcell">{PRICE_STATE[state]}</small>
        </dd>
        <dt>Catalog price</dt><dd>{money(product.price_cents, product.currency)} {product.payment_type === "recurring" ? `per ${product.billing_interval}` : "one-time"}</dd>
        <dt>Last sync</dt>
        <dd>
          {product.stripe_synced_at ? <>{product.stripe_sync_status === "failed" ? "Failed" : "Succeeded"} · {when(product.stripe_synced_at)}</> : "Never"}
          {product.stripe_sync_error && <small className="monarch-subcell is-error">{product.stripe_sync_error}</small>}
        </dd>
      </dl>
      <div className="monarch-inline-actions">
        {product.stripe_product_id ? (
          <Action action={syncStripeProductInfoAction} id={product.id} label="Update Stripe product info" disabled={off} confirm="Sends name, description, primary image and active flag. Prices are not changed." />
        ) : (
          <Action action={createStripeProductAction} id={product.id} label="Create Stripe product" disabled={off} confirm="Creates one Stripe product and links it. No price is created." />
        )}
        <Action
          action={createStripePriceAction}
          id={product.id}
          label={product.stripe_price_id ? "Create new Stripe price for catalog price" : "Create Stripe price"}
          disabled={off || !product.stripe_product_id || product.price_cents === null || state === "in_sync"}
          confirm="Creates a new Stripe price and links it. The previous price is left unchanged."
        />
      </div>
    </section>
  );
}
