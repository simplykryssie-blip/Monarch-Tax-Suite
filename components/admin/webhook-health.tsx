import { fixWebhookAction } from "@/app/(admin)/product-actions";
import { loadWebhookHealth } from "@/lib/stripe-catalog";

/** Whether Stripe sends payment events to this app's webhook, with a one-click fix when only the address or events are off. */
export async function WebhookHealth() {
  const loaded = await loadWebhookHealth();
  if ("error" in loaded) return <p className="monarch-muted">Webhook check: {loaded.error}</p>;
  const { health, canFix } = loaded;
  if (health.state === "ok") {
    return <p className="monarch-muted">Webhook: <b>OK</b> · Stripe sends all payment events to <code>{health.expectedUrl}</code> ({health.endpoint.id}).</p>;
  }
  return (
    <div className="sv-bad">
      <b>WEBHOOK: ACTION NEEDED</b> · payments may not be recorded until this is fixed.
      <ul>{health.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      {health.state === "fixable" && canFix ? (
        <form action={fixWebhookAction}>
          <button className="monarch-secondary" type="submit" title="Updates the existing endpoint. Its signing secret stays the same, so no environment change is needed.">Point the webhook at {health.expectedUrl}</button>
        </form>
      ) : health.state === "fixable" ? (
        <p className="monarch-muted">The one-click fix is available only on the production site.</p>
      ) : (
        <p className="monarch-muted">Fix this in Stripe → Developers → Webhooks. Expected address: <code>{health.expectedUrl}</code>.</p>
      )}
    </div>
  );
}
