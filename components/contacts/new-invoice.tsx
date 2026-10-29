import { loadBrand } from "@/lib/branding/server";
import { documentDeps } from "@/lib/documents/server";
import { Modal } from "@/components/ui/modal";
import { workspaceRepo } from "@/lib/workspace/server";
import { billingSettings, feeProducts, standardFees } from "@/lib/workspace/service.ts";
import { NewInvoiceForm, type InvoiceFormProps } from "./new-invoice-form";

/** A New invoice button that opens the invoice form, with a live preview. Fees, tax and the footer all come from Settings. */
export async function NewInvoice({ open = false, ...props }: Omit<InvoiceFormProps, "header" | "footer" | "taxPercent" | "products" | "standard"> & { /** Start with the form already open (a link from Home). */ open?: boolean }) {
  const repo = workspaceRepo();
  const [brand, profile, settings, products, legacy] = await Promise.all([
    loadBrand().catch(() => null), documentDeps().repo.getProfile().catch(() => null), billingSettings(repo), feeProducts(repo), standardFees(repo),
  ]);
  const header = { name: profile?.display_name || brand?.name || "Your office", logoUrl: brand?.logoUrl ?? null, address: profile?.address ?? null, phone: profile?.phone ?? null, email: profile?.email ?? null };
  return (
    <Modal label="New invoice" title="New invoice" className="monarch-primary" wide defaultOpen={open}>
      <NewInvoiceForm {...props} standard={legacy} products={products.map((p) => ({ id: p.id, kind: p.kind, name: p.name, lines: p.lines }))} taxPercent={settings.tax_percent} header={header} footer={{ refund: settings.refund_policy, terms: settings.terms }} />
    </Modal>
  );
}
