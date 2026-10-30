import { randomUUID } from "node:crypto";
import { hashLicenseKey, isWellFormedLicenseKey } from "./license-keys.ts";
import { ValidationError } from "./validation.ts";
import type { CommerceRepo, License, Product } from "./types.ts";

// Product files: code bundles (.zip, .html, .js, .css) and other deliverables sold with a product.
//
// Security boundary: files are STORED AND DELIVERED, NEVER EXECUTED. Every file is stored as
// application/octet-stream in a private bucket, and buyers get a short-lived signed URL that forces a download, so no
// uploaded file is ever rendered or run as a page on a platform domain. Downloads require an active license for that
// product with a paid order, and every download is logged against the license.

export const FILE_EXTENSIONS = ["zip", "html", "js", "css"] as const;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PRODUCT_BYTES = 200 * 1024 * 1024;
export const MAX_FILES_PER_PRODUCT = 20;
export const STORED_CONTENT_TYPE = "application/octet-stream";
export const DOWNLOAD_URL_SECONDS = 60;

export type ProductFile = {
  id: string;
  product_id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  status: "pending" | "ready" | "removed";
  created_by: string | null;
  created_at: string;
  ready_at: string | null;
  removed_at: string | null;
};

export type DownloadEvent = { id: string; license_id: string; product_id: string; product_file_id: string; file_name: string; client_hash: string | null; created_at: string };

export interface ProductFilesRepo {
  insertFile(input: Pick<ProductFile, "product_id" | "storage_path" | "file_name" | "size_bytes" | "created_by">): Promise<ProductFile>;
  getFile(id: string): Promise<ProductFile | null>;
  updateFile(id: string, patch: Partial<Pick<ProductFile, "status" | "size_bytes" | "ready_at" | "removed_at">>): Promise<ProductFile>;
  /** All non-removed files of a product, oldest first. */
  listFiles(productId: string): Promise<ProductFile[]>;
  addDownload(input: Omit<DownloadEvent, "id" | "created_at">): Promise<DownloadEvent>;
  listDownloads(filter: { licenseId?: string; productId?: string }, limit: number): Promise<DownloadEvent[]>;
}

/** Private object storage. Uploads go straight from the administrator's browser to a one-time signed upload URL. */
export interface FileStore {
  createUploadUrl(path: string): Promise<{ url: string }>;
  /** Size and stored content type of an uploaded object, or null when it is not there. */
  stat(path: string): Promise<{ size: number; contentType: string | null } | null>;
  /** A signed URL that downloads the object under `fileName` (Content-Disposition: attachment). */
  signedDownloadUrl(path: string, fileName: string, seconds: number): Promise<string>;
  remove(paths: string[]): Promise<void>;
  /** Deleted by a person: kept for the 24-hour window, then deleted by the scheduler. */
  discard(paths: string[]): Promise<void>;
}

// ------------------------------------------------------------------- upload

/** A safe download name: the base name only, plain characters, an allowed extension. */
export function cleanFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").normalize("NFKC").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/\s+/g, " ").trim().slice(-120);
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (!(FILE_EXTENSIONS as readonly string[]).includes(ext)) throw new ValidationError(`Only ${FILE_EXTENSIONS.map((e) => `.${e}`).join(", ")} files can be uploaded. Put anything else inside a .zip.`);
  if (base.length <= ext.length + 1 || base.startsWith(".")) throw new ValidationError("Give the file a name, for example calculator-v1.zip.");
  return base;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Checks a requested upload and returns a one-time upload URL. The file is "pending" until finishUpload confirms it. */
export async function startUpload(
  deps: { commerce: CommerceRepo; files: ProductFilesRepo; store: FileStore },
  input: { productId: string; fileName: string; sizeBytes: number; adminId: string },
): Promise<{ file: ProductFile; uploadUrl: string; contentType: string }> {
  const product = await deps.commerce.getProduct(input.productId);
  if (!product) throw new ValidationError("Product not found.");
  if (product.status === "archived") throw new ValidationError("Archived products cannot receive files.");
  const fileName = cleanFileName(input.fileName);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new ValidationError("The file is empty.");
  if (input.sizeBytes > MAX_FILE_BYTES) throw new ValidationError(`Files can be at most ${mb(MAX_FILE_BYTES)}.`);
  const ready = (await deps.files.listFiles(product.id)).filter((f) => f.status === "ready");
  if (ready.length >= MAX_FILES_PER_PRODUCT) throw new ValidationError(`A product can have at most ${MAX_FILES_PER_PRODUCT} files. Remove one first.`);
  if (ready.reduce((n, f) => n + f.size_bytes, 0) + input.sizeBytes > MAX_PRODUCT_BYTES) throw new ValidationError(`A product's files can total at most ${mb(MAX_PRODUCT_BYTES)}.`);
  const file = await deps.files.insertFile({ product_id: product.id, storage_path: `products/${product.id}/${randomUUID()}`, file_name: fileName, size_bytes: input.sizeBytes, created_by: input.adminId });
  const { url } = await deps.store.createUploadUrl(file.storage_path);
  return { file, uploadUrl: url, contentType: STORED_CONTENT_TYPE };
}

/** Confirms an upload landed with the declared size and as plain binary data; otherwise removes it. */
export async function finishUpload(deps: { files: ProductFilesRepo; store: FileStore }, fileId: string, now = new Date()): Promise<ProductFile> {
  const file = await deps.files.getFile(fileId);
  if (!file || file.status === "removed") throw new ValidationError("Upload not found. Start it again.");
  if (file.status === "ready") return file;
  const object = await deps.store.stat(file.storage_path);
  if (!object) throw new ValidationError("The file did not arrive. Try the upload again.");
  const problem = object.contentType !== STORED_CONTENT_TYPE
    ? "The file was not stored as plain binary data, so it was rejected."
    : object.size !== file.size_bytes || object.size > MAX_FILE_BYTES
      ? "The uploaded file's size does not match, so it was rejected."
      : null;
  if (problem) {
    await deps.store.remove([file.storage_path]).catch(() => undefined);
    await deps.files.updateFile(file.id, { status: "removed", removed_at: now.toISOString() });
    throw new ValidationError(`${problem} Try the upload again.`);
  }
  return deps.files.updateFile(file.id, { status: "ready", ready_at: now.toISOString() });
}

/** Removes a file from sale. Its download history is kept; the stored object is deleted. */
export async function removeFile(deps: { files: ProductFilesRepo; store: FileStore }, fileId: string, now = new Date()): Promise<void> {
  const file = await deps.files.getFile(fileId);
  if (!file || file.status === "removed") return;
  await deps.files.updateFile(file.id, { status: "removed", removed_at: now.toISOString() });
  await deps.store.discard([file.storage_path]).catch((e) => console.error(`product-files: could not delete ${file.storage_path}: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`));
}

// ----------------------------------------------------------------- delivery

const NOT_FOUND = "That license key was not found, or it does not include downloads.";

/** The license behind a key, when it may download this product's files: active license, paid order. */
export async function entitledLicense(commerce: CommerceRepo, rawKey: string): Promise<{ license: License; product: Product }> {
  const key = rawKey.trim().toUpperCase();
  if (!isWellFormedLicenseKey(key)) throw new ValidationError("Enter your license key (MTS-XXXXX-XXXXX-XXXXX-XXXXX).");
  const license = await commerce.findLicenseByKeyHash(hashLicenseKey(key));
  if (!license) throw new ValidationError(NOT_FOUND);
  if (license.status !== "active") throw new ValidationError(`This license is ${license.status}, so downloads are not available. Contact support if you think this is a mistake.`);
  const [order, product] = await Promise.all([commerce.getOrder(license.order_id), commerce.getProduct(license.product_id)]);
  if (!product || order?.payment_status !== "paid") throw new ValidationError("This license's order is not paid, so downloads are not available.");
  return { license, product };
}

/** What a license holder may download. */
export async function filesForLicense(deps: { commerce: CommerceRepo; files: ProductFilesRepo }, rawKey: string) {
  const { license, product } = await entitledLicense(deps.commerce, rawKey);
  const files = (await deps.files.listFiles(product.id)).filter((f) => f.status === "ready");
  return { license, product, files };
}

/** Logs the download and returns a short-lived signed URL that saves the file. Checked again on every click. */
export async function issueDownload(
  deps: { commerce: CommerceRepo; files: ProductFilesRepo; store: FileStore },
  input: { rawKey: string; fileId: string; clientHash: string | null },
): Promise<string> {
  const { license, product } = await entitledLicense(deps.commerce, input.rawKey);
  const file = await deps.files.getFile(input.fileId);
  if (!file || file.status !== "ready" || file.product_id !== product.id) throw new ValidationError("That file is not available for this license.");
  const url = await deps.store.signedDownloadUrl(file.storage_path, file.file_name, DOWNLOAD_URL_SECONDS);
  await deps.files.addDownload({ license_id: license.id, product_id: product.id, product_file_id: file.id, file_name: file.file_name, client_hash: input.clientHash });
  return url;
}
