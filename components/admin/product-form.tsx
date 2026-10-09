import type { Product } from "@/lib/commerce/types.ts";

const TYPES = [["software", "Software"], ["digital_download", "Digital download"], ["course", "Course"], ["membership", "Membership"], ["service", "Service / program"]];
const ACCESS = [["license", "License-based"], ["instant_download", "Instant download"], ["course_access", "Course access"], ["manual", "Manual fulfillment"]];

export function ProductForm({ action, product, submitLabel }: { action: (form: FormData) => Promise<void>; product?: Product; submitLabel: string }) {
  return (
    <form action={action} className="monarch-form">
      {product && <input type="hidden" name="id" value={product.id} />}
      <label>
        Product name
        <input name="name" required minLength={2} maxLength={120} defaultValue={product?.name} />
      </label>
      <label>
        Product identifier
        <input name="slug" maxLength={80} pattern="[a-z0-9-]*" defaultValue={product?.slug} placeholder="generated from the name" />
      </label>
      <label className="is-wide">
        Description
        <textarea name="description" rows={3} maxLength={2000} defaultValue={product?.description ?? ""} />
      </label>
      <label>
        Product type
        <select name="product_type" defaultValue={product?.product_type ?? "software"}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>
        Product access
        <select name="access_type" defaultValue={product?.access_type ?? "license"}>
          {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <fieldset className="is-wide">
        <legend>Installation options</legend>
        <label className="monarch-check"><input type="checkbox" name="installation_options" value="self_service" defaultChecked={product?.installation_options.includes("self_service")} /> Self-service</label>
        <label className="monarch-check"><input type="checkbox" name="installation_options" value="done_for_you" defaultChecked={product?.installation_options.includes("done_for_you")} /> Done For You</label>
      </fieldset>
      <label>
        Price (leave blank until verified)
        <input name="price" inputMode="decimal" defaultValue={product?.price_cents != null ? (product.price_cents / 100).toFixed(2) : ""} placeholder="e.g. 75.00" />
      </label>
      <label>
        Currency
        <input name="currency" maxLength={3} defaultValue={product?.currency ?? "usd"} />
      </label>
      <label>
        Stripe product ID
        <input name="stripe_product_id" defaultValue={product?.stripe_product_id ?? ""} placeholder="prod_…" />
      </label>
      <label>
        Stripe price ID (optional)
        <input name="stripe_price_id" defaultValue={product?.stripe_price_id ?? ""} placeholder="price_…" />
      </label>
      <div className="is-wide">
        <button className="monarch-primary" type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
