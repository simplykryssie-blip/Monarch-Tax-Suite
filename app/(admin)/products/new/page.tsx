import { requireAdmin } from "@/lib/admin";
import { ProductEditor } from "@/components/admin/product-editor";
import { Flash, PageTitle } from "@/components/admin/ui";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  return (
    <>
      <PageTitle title="Add a product" back={{ href: "/products", label: "Products" }}>
        Save a draft first, then upload images. Drafts are hidden from customers until you publish.
      </PageTitle>
      <Flash {...await searchParams} />
      <section className="monarch-panel monarch-pad">
        <ProductEditor images={[]} hasVersions={false} />
      </section>
    </>
  );
}
