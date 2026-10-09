import { publishBlockers, ValidationError } from "./validation.ts";
import type { CommerceRepo, NewProduct, Product, ProductStatus } from "./types.ts";

export async function createProduct(repo: CommerceRepo, input: NewProduct): Promise<Product> {
  const existing = (await repo.listProducts()).find((p) => p.slug === input.slug);
  if (existing) throw new ValidationError("A product with this identifier already exists.");
  return repo.createProduct({ ...input, status: "draft" });
}

/** Edits product details. Status changes go through setProductStatus. */
export async function editProduct(repo: CommerceRepo, id: string, input: NewProduct): Promise<Product> {
  const current = await repo.getProduct(id);
  if (!current) throw new ValidationError("Product not found.");
  if (current.status === "archived") throw new ValidationError("Archived products cannot be edited.");
  const clash = (await repo.listProducts()).find((p) => p.slug === input.slug && p.id !== id);
  if (clash) throw new ValidationError("A product with this identifier already exists.");
  const { status: _ignored, ...details } = input;
  void _ignored;
  if (current.status === "published") {
    const blockers = publishBlockers(details);
    if (blockers.length) throw new ValidationError(`A published product must stay sellable: ${blockers.join(" ")}`);
  }
  return repo.updateProduct(id, details);
}

const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ["published", "archived"],
  published: ["unpublished", "archived"],
  unpublished: ["published", "archived"],
  archived: [],
};

export async function setProductStatus(repo: CommerceRepo, id: string, status: ProductStatus): Promise<Product> {
  const current = await repo.getProduct(id);
  if (!current) throw new ValidationError("Product not found.");
  if (!TRANSITIONS[current.status].includes(status)) throw new ValidationError(`A ${current.status} product cannot be ${status}.`);
  if (status === "published") {
    const blockers = publishBlockers(current);
    if (blockers.length) throw new ValidationError(`Not ready to publish: ${blockers.join(" ")}`);
  }
  return repo.updateProduct(id, { status });
}
