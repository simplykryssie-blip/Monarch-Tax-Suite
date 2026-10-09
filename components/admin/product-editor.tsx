"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { saveProductAction, type SaveProductState } from "@/app/(admin)/product-actions";
import { ProductView, type StorefrontImage } from "@/components/storefront/product-view";
import { metadataToText, parseProductForm, ValidationError } from "@/lib/commerce/validation.ts";
import type { NewProduct, Product } from "@/lib/commerce/types.ts";

const CATEGORIES = [
  ["tax_software", "Tax software"],
  ["service_bureau", "Service Bureau package"],
  ["digital_product", "Digital book / template / guide"],
  ["course", "Course / training"],
  ["software_update", "Annual software update"],
  ["other", "Other / future product"],
];
const TYPES = [["software", "Software"], ["digital_download", "Digital download"], ["course", "Course"], ["membership", "Membership"], ["service", "Service / program"]];
const ACCESS = [["license", "License-based"], ["instant_download", "Instant download"], ["course_access", "Course access"], ["manual", "Manual fulfillment"]];

type Fields = {
  name: string; slug: string; description: string; category: string; product_type: string; access_type: string;
  installation_options: string[]; price: string; currency: string; payment_type: string; billing_interval: string;
  features: string; terms: string; disclaimer: string; metadata: string; stripe_product_id: string; stripe_price_id: string;
};

function initialFields(p?: Product): Fields {
  return {
    name: p?.name ?? "",
    slug: p?.slug ?? "",
    description: p?.description ?? "",
    category: p?.category ?? "other",
    product_type: p?.product_type ?? "software",
    access_type: p?.access_type ?? "license",
    installation_options: p?.installation_options ?? [],
    price: p?.price_cents != null ? (p.price_cents / 100).toFixed(2) : "",
    currency: p?.currency ?? "usd",
    payment_type: p?.payment_type ?? "one_time",
    billing_interval: p?.billing_interval ?? "",
    features: (p?.features ?? []).join("\n"),
    terms: p?.terms ?? "",
    disclaimer: p?.disclaimer ?? "",
    metadata: metadataToText(p?.metadata ?? {}),
    stripe_product_id: p?.stripe_product_id ?? "",
    stripe_price_id: p?.stripe_price_id ?? "",
  };
}

/** The same parser the server uses, so client checks and server checks agree. */
function parse(fields: Fields): { product: NewProduct | null; error: string | null } {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => data.append(k, x));
    else data.set(k, v);
  }
  try {
    return { product: parseProductForm(data), error: null };
  } catch (e) {
    if (e instanceof ValidationError) return { product: null, error: e.message };
    throw e;
  }
}

/** Render with key={product.updated_at} so a successful save starts from the saved values. */
export function ProductEditor({ product, images, hasVersions }: { product?: Product; images: StorefrontImage[]; hasVersions: boolean }) {
  const [state, formAction, pending] = useActionState<SaveProductState, FormData>(saveProductAction, {});
  const initial = useMemo(() => initialFields(product), [product]);
  const [fields, setFields] = useState<Fields>(initial);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [clientError, setClientError] = useState<string | null>(null);
  const submitting = useRef(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);

  useEffect(() => { if (state.error) submitting.current = false; }, [state]);

  // Warn before leaving with unsaved changes (tab close/reload and in-app links).
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { if (!submitting.current) e.preventDefault(); };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || submitting.current || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  const set = <K extends keyof Fields>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));
  const toggleOption = (value: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, installation_options: e.target.checked ? [...f.installation_options, value] : f.installation_options.filter((o) => o !== value) }));

  const parsed = parse(fields);
  const preview = parsed.product ?? null;
  const oneTimeOnly = fields.category === "software_update" || hasVersions;
  const isSoftware = fields.category === "tax_software" || fields.category === "software_update" || fields.product_type === "software";
  const published = product?.status === "published";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const { error } = parse(fields);
    if (fields.name.trim().length < 2) { e.preventDefault(); setClientError("Product name is required."); return; }
    if (error) { e.preventDefault(); setClientError(error); return; }
    setClientError(null);
    submitting.current = true;
  }

  return (
    <div className="pe-layout">
      <form action={formAction} onSubmit={onSubmit} className="monarch-form pe-form" noValidate>
        {product && <input type="hidden" name="id" value={product.id} />}
        {(clientError || state.error) && <div className="monarch-alert is-error is-wide" role="alert">{clientError ?? state.error}</div>}
        {dirty && <div className="pe-dirty is-wide" role="status">Unsaved changes</div>}

        <h3 className="pe-section is-wide">Product details</h3>
        <label>Product name *<input name="name" required minLength={2} maxLength={120} value={fields.name} onChange={set("name")} /></label>
        <label>Product identifier<input name="slug" maxLength={80} pattern="[a-z0-9-]*" value={fields.slug} onChange={set("slug")} placeholder="generated from the name" /></label>
        <label>Category *
          <select name="category" value={fields.category} onChange={set("category")}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Product type
          <select name="product_type" value={fields.product_type} onChange={set("product_type")}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="is-wide">Description<textarea name="description" rows={5} maxLength={4000} value={fields.description} onChange={set("description")} /></label>
        <label className="is-wide">Features / what&apos;s included (one per line)<textarea name="features" rows={5} value={fields.features} onChange={set("features")} placeholder={"2025 and 2026 tax years\nChild Tax Credit estimates"} /></label>

        <h3 className="pe-section is-wide">Pricing</h3>
        <label>Price (leave blank until verified)<input name="price" inputMode="decimal" value={fields.price} onChange={set("price")} placeholder="e.g. 75.00" /></label>
        <label>Currency<input name="currency" maxLength={3} value={fields.currency} onChange={set("currency")} /></label>
        <label>Payment type
          <select name="payment_type" value={fields.payment_type} onChange={set("payment_type")}>
            <option value="one_time">One-time payment</option>
            <option value="recurring" disabled={oneTimeOnly}>Recurring{oneTimeOnly ? " (not allowed for this product)" : ""}</option>
          </select>
        </label>
        {fields.payment_type === "recurring" ? (
          <label>Billing interval *
            <select name="billing_interval" value={fields.billing_interval} onChange={set("billing_interval")}>
              <option value="">Choose…</option><option value="month">Monthly</option><option value="year">Yearly</option>
            </select>
          </label>
        ) : <div className="pe-note">One-time payment. No subscription or automatic renewal.</div>}

        {isSoftware && (
          <div className="pe-callout is-wide">
            <b>Licensing &amp; annual updates.</b>{" "}
            {fields.category === "software_update"
              ? "Annual update products are one-time purchases that apply a new tax-year version to an existing license. They never create a new license."
              : hasVersions
                ? "Sold as a lifetime license for the purchased tax-year version. Newer tax years are optional one-time updates, managed in Tax-year versions below. Bug fixes are included."
                : "License-based software. Add tax-year versions after saving to offer optional one-time annual updates."}
          </div>
        )}

        <h3 className="pe-section is-wide">Access &amp; fulfillment</h3>
        <label>Product access
          <select name="access_type" value={fields.access_type} onChange={set("access_type")}>
            {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>Installation options</legend>
          <label className="monarch-check"><input type="checkbox" name="installation_options" value="self_service" checked={fields.installation_options.includes("self_service")} onChange={toggleOption("self_service")} /> Self-service</label>
          <label className="monarch-check"><input type="checkbox" name="installation_options" value="done_for_you" checked={fields.installation_options.includes("done_for_you")} onChange={toggleOption("done_for_you")} /> Done For You</label>
        </fieldset>

        <h3 className="pe-section is-wide">Terms &amp; disclaimers</h3>
        <label className="is-wide">Terms, refunds &amp; transfers<textarea name="terms" rows={4} maxLength={5000} value={fields.terms} onChange={set("terms")} /></label>
        <label className="is-wide">Disclaimer<textarea name="disclaimer" rows={3} maxLength={5000} value={fields.disclaimer} onChange={set("disclaimer")} /></label>

        <h3 className="pe-section is-wide">Stripe mapping (internal)</h3>
        <p className="monarch-muted is-wide">Saving only updates the Monarch catalog; it never calls Stripe. Use the Stripe panel to sync the Stripe product or create a new price.</p>
        <label>Stripe product ID<input name="stripe_product_id" value={fields.stripe_product_id} onChange={set("stripe_product_id")} placeholder="prod_…" /></label>
        <label>Stripe price ID<input name="stripe_price_id" value={fields.stripe_price_id} onChange={set("stripe_price_id")} placeholder="price_…" /></label>
        <label className="is-wide">Product settings (one <code>key: value</code> per line)<textarea name="metadata" rows={3} value={fields.metadata} onChange={set("metadata")} placeholder="checkout_url: https://buy.stripe.com/…" /></label>

        <div className="is-wide pe-actions">
          {published ? (
            <button className="monarch-primary" name="intent" value="draft" type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
          ) : (
            <>
              <button className="monarch-secondary" name="intent" value="draft" type="submit" disabled={pending}>{pending ? "Saving…" : "Save draft"}</button>
              <button className="monarch-primary" name="intent" value="publish" type="submit" disabled={pending}>Save &amp; publish</button>
            </>
          )}
          {product && <a className="monarch-secondary" href={`/preview/product/${product.id}`} target="_blank" rel="noopener">Open full preview ↗</a>}
        </div>
      </form>

      <aside className="pe-preview" aria-label="Live storefront preview">
        <div className="pe-preview-bar">
          <b>Live preview</b>
          <div role="group" aria-label="Preview device">
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
            <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button>
          </div>
        </div>
        {parsed.error && <p className="pe-preview-warn">Preview paused: {parsed.error}</p>}
        <div className={`sf-frame is-${device}`}>
          {preview ? (
            <ProductView preview images={images} product={{ ...preview, category: preview.category ?? "other", payment_type: preview.payment_type ?? "one_time", billing_interval: preview.billing_interval ?? null, features: preview.features ?? [], terms: preview.terms ?? null, disclaimer: preview.disclaimer ?? null, metadata: preview.metadata ?? {} }} />
          ) : (
            <div className="sf-placeholder">Fix the highlighted field to update the preview.</div>
          )}
        </div>
        <p className="monarch-muted">Preview only: nothing is published, no order is created and no payment is taken.</p>
      </aside>
    </div>
  );
}
