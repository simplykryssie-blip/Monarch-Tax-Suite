import { loadBrand } from "@/lib/branding/server";
import { Modal } from "@/components/ui/modal";
import { NewInvoiceForm, type InvoiceFormProps } from "./new-invoice-form";

/** A New invoice button that opens the invoice form, with a live preview. The standard fees come from Settings and are only included or not. */
export async function NewInvoice(props: Omit<InvoiceFormProps, "office">) {
  const office = (await loadBrand().catch(() => null))?.name ?? "Your office";
  return (
    <Modal label="New invoice" title="New invoice" className="monarch-primary" wide>
      <NewInvoiceForm {...props} office={office} />
    </Modal>
  );
}
