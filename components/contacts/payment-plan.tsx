import { Modal } from "@/components/ui/modal";
import { removePaymentPlanAction, setPaymentPlanAction } from "@/app/(admin)/workspace/actions";
import { PLAN_EVERY, type Installment } from "@/lib/workspace/plan.ts";
import type { Invoice } from "@/lib/workspace/types.ts";

/** A Payment plan button: split an unpaid invoice into scheduled payments, or take the plan off. */
export function PaymentPlan({ invoice: i, plan, back }: { invoice: Invoice; plan: Installment[]; back: string }) {
  if (i.status === "paid" || i.status === "void" || i.paid_cents > 0) return null;
  return (
    <Modal label={plan.length ? "Payment plan" : "Set up payment plan"} title={`Payment plan for ${i.number}`} className="monarch-link">
      <form action={setPaymentPlanAction} className="monarch-form">
        <input type="hidden" name="id" value={i.id} />
        <input type="hidden" name="back" value={back} />
        <label>Payments<select name="plan_count" defaultValue={plan.length || 2}>{Array.from({ length: 11 }, (_, n) => n + 2).map((n) => <option key={n} value={n}>{n} payments</option>)}</select></label>
        <label>First payment due *<input name="plan_first_due" type="date" required defaultValue={plan[0]?.due_on ?? ""} /></label>
        <label>How often<select name="plan_every" defaultValue="month">{Object.entries(PLAN_EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="is-wide"><button className="monarch-primary">{plan.length ? "Replace plan" : "Set up plan"}</button></div>
      </form>
      {plan.length > 0 && (
        <form action={removePaymentPlanAction} className="monarch-form">
          <input type="hidden" name="id" value={i.id} />
          <input type="hidden" name="back" value={back} />
          <div className="is-wide"><button className="monarch-link is-danger">Remove the payment plan</button></div>
        </form>
      )}
    </Modal>
  );
}
