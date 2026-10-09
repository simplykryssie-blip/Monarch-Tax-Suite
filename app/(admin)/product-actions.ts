"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type Stripe from "stripe";
import { commerceRepo, imageStore, requireAdmin, stripeClient } from "@/lib/admin";
import { createProduct, duplicateProduct, editProduct, setProductStatus } from "@/lib/commerce/catalog.ts";
import { removeProductImage, setPrimaryImage, updateImageAlt, uploadProductImage } from "@/lib/commerce/images.ts";
import { createStripePrice, createStripeProduct, syncStripeProductInfo, type StripePort, type SyncResult } from "@/lib/commerce/stripe-sync.ts";
import { parseProductForm, ValidationError } from "@/lib/commerce/validation.ts";
import { checkVersionPrice, createVersionPrice, linkVersionPrice, verifyCatalogProduct, type StripeCatalogPort } from "@/lib/commerce/stripe-verify.ts";
import { stripeCatalogPort } from "@/lib/stripe-catalog";

// Product editor, image and Stripe actions. Every action re-checks
// administrator access server-side before touching data or storage.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== "string" || !UUID.test(value)) throw new ValidationError("Invalid record reference.");
  return value;
}
const notice = (path: string, key: "notice" | "error", message: string) => `${path}?${key}=${encodeURIComponent(message)}`;

// ------------------------------------------------------------------ editor

export type SaveProductState = { error?: string };

/** Creates or updates a product, then optionally publishes it ("Save & publish"). */
export async function saveProductAction(_prev: SaveProductState, form: FormData): Promise<SaveProductState> {
  await requireAdmin();
  const repo = commerceRepo();
  const publish = form.get("intent") === "publish";
  let target: string;
  try {
    const input = parseProductForm(form);
    const existingId = form.get("id");
    const product = existingId ? await editProduct(repo, uuid(form, "id"), input) : await createProduct(repo, input);
    target = notice(`/products/${product.id}`, "notice", existingId ? "Product saved." : "Product created as a draft.");
    if (publish && product.status !== "published") {
      try {
        await setProductStatus(repo, product.id, "published");
        target = notice(`/products/${product.id}`, "notice", "Product saved and published.");
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        // The edits are saved; only publishing was refused.
        target = notice(`/products/${product.id}`, "error", `Saved, but not published. ${error.message}`);
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function duplicateProductAction(form: FormData) {
  const admin = await requireAdmin();
  let target: string;
  try {
    const copy = await duplicateProduct(commerceRepo(), imageStore(), uuid(form, "id"), admin.userId);
    target = notice(`/products/${copy.id}`, "notice", "Draft copy created. Stripe links were not copied.");
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    target = notice("/products", "error", error.message);
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// ------------------------------------------------------------------ images

export type ImageActionState = { ok?: boolean; message?: string };

async function imageAction(fn: () => Promise<string>): Promise<ImageActionState> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    console.error("Product image action failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: "The image could not be saved. Please try again." };
  }
}

/** Uploads a new image, or replaces one when `replace_id` is present. */
export async function uploadProductImageAction(_prev: ImageActionState, form: FormData): Promise<ImageActionState> {
  const admin = await requireAdmin();
  return imageAction(async () => {
    const productId = uuid(form, "product_id");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an image to upload.");
    const replaceId = form.get("replace_id") ? uuid(form, "replace_id") : undefined;
    const alt = form.get("alt_text");
    await uploadProductImage(
      commerceRepo(),
      imageStore(),
      productId,
      { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type, fileName: file.name, altText: typeof alt === "string" ? alt : null },
      admin.userId,
      replaceId,
    );
    return replaceId ? "Image replaced." : "Image uploaded.";
  });
}

export async function removeProductImageAction(_prev: ImageActionState, form: FormData): Promise<ImageActionState> {
  await requireAdmin();
  return imageAction(async () => {
    await removeProductImage(commerceRepo(), imageStore(), uuid(form, "image_id"));
    return "Image removed.";
  });
}

export async function setPrimaryImageAction(_prev: ImageActionState, form: FormData): Promise<ImageActionState> {
  await requireAdmin();
  return imageAction(async () => {
    await setPrimaryImage(commerceRepo(), uuid(form, "image_id"));
    return "Primary image updated.";
  });
}

export async function updateImageAltAction(_prev: ImageActionState, form: FormData): Promise<ImageActionState> {
  await requireAdmin();
  return imageAction(async () => {
    const alt = form.get("alt_text");
    await updateImageAlt(commerceRepo(), uuid(form, "image_id"), typeof alt === "string" ? alt : null);
    return "Alt text saved.";
  });
}

// ------------------------------------------------------------------ Stripe

function stripePort(stripe: Stripe): StripePort {
  return {
    updateProduct: (id, params) => stripe.products.update(id, params),
    // Idempotency keys stop a double-submit from creating two Stripe objects.
    createProduct: (params) => stripe.products.create(params, { idempotencyKey: `monarch-product-${params.metadata.monarch_product_id}` }),
    createPrice: (params) =>
      stripe.prices.create(params, {
        idempotencyKey: `monarch-price-${params.metadata.monarch_product_id}-${params.unit_amount}-${params.currency}-${params.recurring?.interval ?? "once"}`,
      }),
  };
}

async function stripeAction(form: FormData, run: (port: StripePort, productId: string) => Promise<SyncResult>) {
  await requireAdmin();
  const productId = uuid(form, "id");
  const back = `/products/${productId}`;
  const stripe = stripeClient();
  let target: string;
  if (!stripe) {
    target = notice(back, "error", "Stripe is not connected: STRIPE_SECRET_KEY is not configured, so nothing was sent to Stripe.");
  } else {
    try {
      const result = await run(stripePort(stripe), productId);
      target = notice(back, result.ok ? "notice" : "error", result.ok ? result.message : `Stripe sync failed: ${result.message}`);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      target = notice(back, "error", error.message);
    }
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function syncStripeProductInfoAction(form: FormData) {
  await stripeAction(form, (port, productId) => syncStripeProductInfo(commerceRepo(), imageStore(), port, productId));
}

export async function createStripeProductAction(form: FormData) {
  await stripeAction(form, (port, productId) => createStripeProduct(commerceRepo(), imageStore(), port, productId));
}

export async function createStripePriceAction(form: FormData) {
  await stripeAction(form, (port, productId) => createStripePrice(commerceRepo(), port, productId));
}

// ------------------------------------------------------- Stripe verification

async function verifyAction(form: FormData, run: (port: StripeCatalogPort, productId: string) => Promise<string>) {
  await requireAdmin();
  const productId = uuid(form, "product_id");
  const back = `/products/${productId}`;
  const port = stripeCatalogPort();
  let target: string;
  if (!port) {
    target = notice(back, "error", process.env.STRIPE_SECRET_KEY
      ? "STRIPE_SECRET_KEY is set but is not a Stripe secret (sk_) or restricted (rk_) key, so nothing was checked."
      : "Stripe is not connected: STRIPE_SECRET_KEY is not configured on the server, so nothing was checked.");
  } else {
    try {
      target = notice(back, "notice", await run(port, productId));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      target = notice(back, "error", error.message);
    }
  }
  revalidatePath("/", "layout");
  redirect(target);
}

/** Reads the product's configured Stripe product and price and records what Stripe reports. Changes no ids. */
export async function verifyStripeMappingAction(form: FormData) {
  await verifyAction(form, async (port, productId) => {
    const v = await verifyCatalogProduct(commerceRepo(), port, productId);
    if (!v.ok) throw new ValidationError(`Stripe verification found problems (${port.mode} mode): ${v.issues.join(" ")}`);
    return `Verified in Stripe (${port.mode} mode): ${v.product?.name ?? "product"} · ${v.price?.id} · $${((v.price?.unit_amount ?? 0) / 100).toFixed(2)} ${v.price?.currency.toUpperCase()} ${v.price?.type === "one_time" ? "one-time" : "recurring"}.`;
  });
}

/** Verifies a version's linked price, or finds matching prices on the Annual Update product. Links nothing. */
export async function checkVersionPriceAction(form: FormData) {
  await verifyAction(form, async (port) => {
    const v = await checkVersionPrice(commerceRepo(), port, uuid(form, "id"));
    const messages: Record<string, string> = {
      linked_verified: "The linked Stripe price is verified.",
      linked_invalid: "The linked Stripe price does not match. See the issues below.",
      reuse_candidate: "One matching Stripe price was found. Review it and confirm to link it.",
      create_required: "No matching Stripe price exists. You can create one after confirming.",
      ambiguous: "Several matching Stripe prices exist. Review them and link the correct one.",
      product_invalid: "The Annual Update product in Stripe is not usable. See the issues below.",
    };
    if (!v.state) throw new ValidationError(v.issues.join(" ") || "Stripe check failed.");
    return messages[v.state];
  });
}

export async function linkVersionPriceAction(form: FormData) {
  await verifyAction(form, async (port) => {
    const priceId = String(form.get("price_id") ?? "");
    await linkVersionPrice(commerceRepo(), port, uuid(form, "id"), priceId, form.get("confirm") === "on");
    return `Stripe price ${priceId} verified and linked to this version.`;
  });
}

export async function createVersionPriceAction(form: FormData) {
  await verifyAction(form, async (port) => {
    const v = await createVersionPrice(commerceRepo(), port, uuid(form, "id"), form.get("confirm") === "on");
    return `New one-time Stripe price ${v.stripe_update_price_id} created on the Annual Update product and linked.`;
  });
}
