import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { publishBlockers } from "@/lib/commerce/validation.ts";
import { setProductStatusAction, updateProductAction } from "../../actions";
import { ProductForm } from "@/components/admin/product-form";
import { Badge, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

const NEXT: Record<string, { status: string; label: string }[]> = {
  draft: [{ status: "published", label: "Publish" }, { status: "archived", label: "Archive" }],
  published: [{ status: "unpublished", label: "Unpublish" }, { status: "archived", label: "Archive" }],
  unpublished: [{ status: "published", label: "Publish" }, { status: "archived", label: "Archive" }],
  archived: [],
};

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const result = await load(() => commerceRepo().getProduct(id));
  if (!result.ok) return <SetupRequired message={result.message} />;
  const product = result.data;
  if (!product) notFound();
  const blockers = publishBlockers(product);

  return (
    <>
      <PageTitle title={product.name} back={{ href: "/products", label: "Products" }}>
        <Badge value={product.status} /> · Updated {when(product.updated_at)}
      </PageTitle>
      <Flash {...await searchParams} />
      <section className="monarch-panel monarch-pad monarch-status-bar">
        <div>
          <b>Status: </b><Badge value={product.status} />
          {product.status !== "published" && blockers.length > 0 && <p className="monarch-muted">Before publishing: {blockers.join(" ")}</p>}
        </div>
        <div className="monarch-inline-actions">
          {NEXT[product.status].map((n) => (
            <form key={n.status} action={setProductStatusAction}>
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="status" value={n.status} />
              <button className={n.status === "archived" ? "monarch-secondary is-danger" : "monarch-secondary"} type="submit">{n.label}</button>
            </form>
          ))}
        </div>
      </section>
      {product.status === "archived" ? (
        <div className="monarch-notice"><b>ARCHIVED</b> Archived products are read-only and hidden from sale.</div>
      ) : (
        <section className="monarch-panel monarch-pad">
          <ProductForm action={updateProductAction} product={product} submitLabel="Save changes" />
        </section>
      )}
    </>
  );
}
