import { serviceClient } from "@/lib/supabase/service";
import { SupabaseCommerceRepo } from "@/lib/commerce/supabase-repo.ts";
import { getIntake } from "@/lib/commerce/fulfillment.ts";
import { IntakeForm } from "@/components/install/intake-form";

// Public, token-gated page where a customer tells us where the calculator will
// be installed. Shows no customer, order, or license details.
export default async function InstallIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const repo = new SupabaseCommerceRepo(serviceClient());
  const installation = await getIntake(repo, token);
  const product = installation ? await repo.getProduct(installation.product_id) : null;
  return (
    <main className="monarch-public">
      <div className="monarch-public-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE</div>
        <h1>{product?.name ?? "Calculator installation"}</h1>
        {!installation || !product ? (
          <p>This link is invalid, already used, or has expired. Please contact Monarch Tax Suite for a new one.</p>
        ) : (
          <>
            <p>Tell us where the calculator will be installed so we can authorize your domain and send the right instructions.</p>
            <IntakeForm token={token} options={product.installation_options} defaultType={installation.installation_type} />
          </>
        )}
      </div>
    </main>
  );
}
