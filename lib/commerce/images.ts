import { randomUUID } from "node:crypto";
import { ValidationError } from "./validation.ts";
import type { CommerceRepo, ImageStore, ImageType, ProductImage } from "./types.ts";

// Product images: files go to object storage under products/<product>/<uuid>.<ext>;
// the database keeps only the path and metadata. Every function here is called
// from server actions after the administrator check.

// 4 MB keeps uploads under the hosting platform's 4.5 MB request limit.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 8;
const EXT: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Detects the real image type from file signature bytes (the browser-declared type is not trusted). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Reads pixel dimensions from PNG / JPEG / WebP headers (best effort; null when unknown). */
export function imageDimensions(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (type === "image/webp" && bytes.length >= 30) {
      const chunk = String.fromCharCode(...bytes.slice(12, 16));
      if (chunk === "VP8X") return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
      if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const len = view.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export type UploadInput = { bytes: Uint8Array; declaredType: string; fileName: string; altText: string | null };

export function validateImage(input: UploadInput): { type: ImageType; width: number | null; height: number | null } {
  if (input.bytes.byteLength === 0) throw new ValidationError("Choose an image to upload.");
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError("Images must be 4 MB or smaller.");
  const type = sniffImageType(input.bytes);
  if (!type) throw new ValidationError("Upload a JPG, PNG, or WebP image.");
  const declared = input.declaredType === "image/jpg" ? "image/jpeg" : input.declaredType;
  if (declared && declared !== "application/octet-stream" && declared !== type) throw new ValidationError("The file contents do not match its image type.");
  const dims = imageDimensions(input.bytes, type);
  if (dims && (dims.width > 10000 || dims.height > 10000)) throw new ValidationError("Images must be at most 10,000 pixels on each side.");
  return { type, width: dims?.width ?? null, height: dims?.height ?? null };
}

function cleanAlt(alt: string | null): string | null {
  const text = (alt ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  return text || null;
}

/**
 * Uploads an image for a product. With `replaceImageId`, the new file takes the
 * old image's place (primary flag and position) and the old file is removed.
 */
export async function uploadProductImage(
  repo: CommerceRepo,
  store: ImageStore,
  productId: string,
  input: UploadInput,
  actorId: string,
  replaceImageId?: string,
): Promise<ProductImage> {
  const product = await repo.getProduct(productId);
  if (!product) throw new ValidationError("Product not found.");
  if (product.status === "archived") throw new ValidationError("Archived products cannot be changed.");
  const { type, width, height } = validateImage(input);
  const existing = await repo.listProductImages([productId]);
  const replacing = replaceImageId ? existing.find((i) => i.id === replaceImageId) : undefined;
  if (replaceImageId && !replacing) throw new ValidationError("The image to replace was not found.");
  if (!replacing && existing.length >= MAX_IMAGES_PER_PRODUCT) throw new ValidationError(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images.`);

  const path = `products/${productId}/${randomUUID()}.${EXT[type]}`;
  await store.put(path, input.bytes, type);
  try {
    if (replacing) await repo.deleteProductImage(replacing.id);
    const image = await repo.addProductImage({
      product_id: productId,
      storage_path: path,
      content_type: type,
      size_bytes: input.bytes.byteLength,
      width,
      height,
      alt_text: cleanAlt(input.altText) ?? replacing?.alt_text ?? null,
      is_primary: replacing ? replacing.is_primary : existing.length === 0,
      sort_order: replacing ? replacing.sort_order : Math.max(-1, ...existing.map((i) => i.sort_order)) + 1,
      created_by: actorId,
    });
    if (replacing) await store.remove([replacing.storage_path]);
    return image;
  } catch (error) {
    await store.remove([path]).catch(() => undefined);
    throw error;
  }
}

export async function removeProductImage(repo: CommerceRepo, store: ImageStore, imageId: string) {
  const image = await repo.getProductImage(imageId);
  if (!image) throw new ValidationError("Image not found.");
  await repo.deleteProductImage(image.id);
  await store.remove([image.storage_path]);
  if (image.is_primary) {
    const [next] = (await repo.listProductImages([image.product_id])).sort((a, b) => a.sort_order - b.sort_order);
    if (next) await repo.updateProductImage(next.id, { is_primary: true });
  }
}

export async function setPrimaryImage(repo: CommerceRepo, imageId: string) {
  const image = await repo.getProductImage(imageId);
  if (!image) throw new ValidationError("Image not found.");
  for (const other of await repo.listProductImages([image.product_id])) {
    if (other.is_primary && other.id !== image.id) await repo.updateProductImage(other.id, { is_primary: false });
  }
  return repo.updateProductImage(image.id, { is_primary: true });
}

export async function updateImageAlt(repo: CommerceRepo, imageId: string, alt: string | null) {
  const image = await repo.getProductImage(imageId);
  if (!image) throw new ValidationError("Image not found.");
  return repo.updateProductImage(image.id, { alt_text: cleanAlt(alt) });
}

/** Copies every image of one product to another as independent files. */
export async function copyProductImages(repo: CommerceRepo, store: ImageStore, fromProductId: string, toProductId: string, actorId: string) {
  for (const image of (await repo.listProductImages([fromProductId])).sort((a, b) => a.sort_order - b.sort_order)) {
    const path = `products/${toProductId}/${randomUUID()}.${EXT[image.content_type]}`;
    await store.copy(image.storage_path, path);
    await repo.addProductImage({
      product_id: toProductId,
      storage_path: path,
      content_type: image.content_type,
      size_bytes: image.size_bytes,
      width: image.width,
      height: image.height,
      alt_text: image.alt_text,
      is_primary: image.is_primary,
      sort_order: image.sort_order,
      created_by: actorId,
    });
  }
}

export function primaryImage(images: ProductImage[]): ProductImage | null {
  return images.find((i) => i.is_primary) ?? [...images].sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
}
