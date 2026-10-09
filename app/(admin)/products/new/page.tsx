import { requireAdmin } from "@/lib/admin";
import { createProductAction } from "../../actions";
import { ProductForm } from "@/components/admin/product-form";
import { Flash, PageTitle } from "@/components/admin/ui";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  return (
    <>
      <PageTitle title="Add a product" back={{ href: "/products", label: "Products" }}>New products are saved as drafts. Publish once the price and Stripe product are verified.</PageTitle>
      <Flash {...await searchParams} />
      <section className="monarch-panel monarch-pad">
        <ProductForm action={createProductAction} submitLabel="Create draft product" />
      </section>
    </>
  );
}
