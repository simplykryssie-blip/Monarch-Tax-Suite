import type { Action, AutomationRepo, Condition, WorkflowStatus } from "./types.ts";

// The starting set. "Install defaults" is idempotent: it only creates what is missing (matched by key) and never
// overwrites templates or workflows an administrator has edited.

type DefaultTemplate = { key: string; name: string; subject: string; body: string };
type DefaultWorkflow = {
  key: string;
  name: string;
  description: string;
  trigger: string;
  conditions: Condition[];
  actions: (templateIdOf: (key: string) => string) => Action[];
  status: WorkflowStatus;
  cooldown_hours?: number;
};

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "onboarding_welcome",
    name: "Onboarding: welcome and setup link",
    subject: "Your Monarch Tax Suite calculator is ready to set up",
    body: `# Welcome to Monarch Tax Suite, {{customer_first_name}}

Your calculator license ({{license_reference}}) has been created for {{business_name}}.

Use your secure setup page to confirm your website and connect GoHighLevel, so calculator leads go straight into your own account:

{{setup_link}}

You can complete setup yourself, in a few minutes, with nothing to send us:
1. Confirm your business details and enter your main website address. The calculator shows only on this website.
2. Connect your GoHighLevel account (or paste a workflow link) and press Test connection.
3. Copy your calculator code onto your page and press Finish setup.

This link is private to you and expires in 14 days. If your license is still being prepared when you open it, the page will say so and we will email you when it is ready.

Need help? Reply to this email or write to {{support_email}}.`,
  },
  {
    key: "paid_welcome",
    name: "Purchase: thank you and setup link",
    subject: "Thank you for your purchase: set up your Monarch calculator",
    body: `# Thank you, {{customer_first_name}}

We received your payment for order #{{order_number}}, and your calculator license ({{license_reference}}) has been created.

Your secure setup page is where you confirm your website and connect GoHighLevel:

{{setup_link}}

We activate your license and then the setup page lets you finish. If it says your license is still being prepared, that is normal: we will email you as soon as it is ready.

This link is private to you and expires in 14 days. Questions? Reply to this email or write to {{support_email}}.`,
  },
  {
    key: "license_ready",
    name: "License activated: setup is ready",
    subject: "Your Monarch Tax Suite license is active",
    body: `# Your license is active, {{customer_first_name}}

Your calculator license ({{license_reference}}) is now active. You can finish setup any time:

{{setup_link}}

Questions? Write to {{support_email}}.`,
  },
  {
    key: "crm_connected",
    name: "CRM connected: confirmation and embed instructions",
    subject: "GoHighLevel is connected to your calculator",
    body: `# GoHighLevel is connected

Hi {{customer_first_name}}, your calculator can now send leads to {{crm_account}}.

Next, add the calculator to your website. The calculator displays only on your authorized website: {{authorized_domain}}.

{{embed_instructions}}

If the calculator does not appear, open your setup page to check the website address:

{{setup_link}}

Questions? Write to {{support_email}}.`,
  },
  {
    key: "installation_recorded",
    name: "Installation details received",
    subject: "We received your calculator installation details",
    body: `# We have your installation details

Hi {{customer_first_name}}, thank you. Your installation status is: {{installation_status}}.

{{embed_instructions}}

We will confirm once the calculator is verified on your website. Questions? Write to {{support_email}}.`,
  },
  {
    key: "installation_verified",
    name: "Installation verified",
    subject: "Your Monarch calculator is installed",
    body: `# Your calculator is installed

Hi {{customer_first_name}}, we verified your calculator installation for {{authorized_domain}}.

If it ever stops displaying:
1. Make sure the page is on {{authorized_domain}} (or its www version).
2. Check that the code has not been removed from the page.
3. Open your setup page to review your website address and CRM connection.

Questions? Write to {{support_email}}.`,
  },
  {
    key: "lead_delivery_needs_attention",
    name: "Lead delivery needs attention",
    subject: "Action needed: calculator leads are not reaching your CRM",
    body: `# Your calculator leads need attention

Hi {{customer_first_name}}, a visitor tried to send their details through your calculator but they did not reach your CRM.

{{failure_reason}}

Reconnect from your setup page:

{{setup_link}}

Visitors were shown an error and asked to try again. Questions? Write to {{support_email}}.`,
  },
  {
    key: "onboarding_completed",
    name: "Onboarding completed: confirmation and install guide",
    subject: "You're all set: your Monarch calculator setup is complete",
    body: `# Setup complete, {{customer_first_name}}

Your calculator is authorized for {{authorized_domain}} and your leads go to {{crm_account}}.

{{embed_instructions}}

If the calculator area stays blank, check that the page is on {{authorized_domain}} (or its www version) and that the code was pasted exactly as shown. You can reopen your setup page any time from your original setup email.

Questions? Write to {{support_email}}.`,
  },
  {
    key: "license_suspended",
    name: "License suspended notice",
    subject: "Your Monarch Tax Suite license has been suspended",
    body: `# Your license is suspended

Hi {{customer_first_name}}, your calculator license ({{license_reference}}) has been suspended and the calculator will not display until it is restored.

Please contact us at {{support_email}} so we can help.`,
  },
  {
    key: "license_revoked",
    name: "License revoked notice",
    subject: "Your Monarch Tax Suite license has been revoked",
    body: `# Your license is no longer active

Hi {{customer_first_name}}, your calculator license ({{license_reference}}) has been revoked and the calculator no longer displays.

If you believe this is a mistake, contact us at {{support_email}}.`,
  },
];

const email = (templateKey: string, to: "customer" | "support" = "customer", link = false) => (id: (k: string) => string): Action[] => [
  { type: "send_email", template_id: id(templateKey), to, include_setup_link: link },
];

export const DEFAULT_WORKFLOWS: DefaultWorkflow[] = [
  { key: "manual_license_created", name: "Manual license created: onboarding email", description: "Sends the customer their secure setup link when an administrator creates a manual (internal or reconciled) license.", trigger: "license.manual_created", conditions: [], actions: email("onboarding_welcome", "customer", true), status: "active" },
  { key: "paid_license_created", name: "Paid license created: onboarding email", description: "Runs only after a signature-verified Stripe payment created the license.", trigger: "license.paid_created", conditions: [], actions: email("paid_welcome", "customer", true), status: "active" },
  { key: "license_activated", name: "License key issued: setup is ready", description: "Sent when an administrator issues the key for a license that was still being prepared (paid licenses). Manual licenses are activated automatically and do not send it.", trigger: "license.activated", conditions: [], actions: email("license_ready", "customer", true), status: "active" },
  { key: "invite_requested", name: "Setup email requested again: send a fresh link", description: "Sends a new secure setup link when an administrator or the customer asks for one. The earlier link is retired once the new email goes out.", trigger: "onboarding.invite_requested", conditions: [], actions: email("onboarding_welcome", "customer", true), status: "active" },
  { key: "onboarding_completed", name: "Onboarding completed: confirmation email", description: "Sent once, when every setup step is genuinely finished.", trigger: "onboarding.completed", conditions: [], actions: email("onboarding_completed"), status: "active" },
  { key: "onboarding_started", name: "Onboarding started: record progress", description: "Records that the customer opened their setup link. It does not mean setup is complete.", trigger: "onboarding.started", conditions: [], actions: () => [{ type: "record_note", note: "Customer opened their secure setup link." }], status: "active" },
  { key: "crm_connected", name: "GoHighLevel connected: confirmation email", description: "Runs only after the connection was verified and saved.", trigger: "crm.connected", conditions: [{ field: "provider", op: "eq", value: "highlevel" }], actions: email("crm_connected", "customer", true), status: "active" },
  { key: "installation_recorded", name: "Installation recorded: guidance email", description: "Sends embed instructions after the customer submits their installation details.", trigger: "installation.recorded", conditions: [], actions: email("installation_recorded"), status: "active" },
  { key: "installation_verified", name: "Installation verified: completion notice", description: "Sent when an administrator marks the installation active after confirming it.", trigger: "installation.verified", conditions: [], actions: email("installation_verified"), status: "active" },
  { key: "lead_delivered", name: "Lead delivered: record outcome", description: "Records that a lead reached the customer's CRM. No lead contents are stored.", trigger: "lead.delivered", conditions: [], actions: () => [{ type: "record_note", note: "A calculator lead was delivered to the customer's CRM." }], status: "active" },
  { key: "lead_delivery_failed", name: "Lead delivery failed: notify the customer", description: "Emails the customer when GoHighLevel rejects the connection (needs a reconnect). At most one email per day per license. Off by default.", trigger: "lead.delivery_failed", conditions: [{ field: "error_kind", op: "eq", value: "auth" }], actions: email("lead_delivery_needs_attention", "customer", true), status: "paused", cooldown_hours: 24 },
  { key: "license_suspended", name: "License suspended: notice", description: "Emails the customer when an administrator suspends a license. Off by default. Email problems never change a license.", trigger: "license.suspended", conditions: [], actions: email("license_suspended"), status: "paused" },
  { key: "license_revoked", name: "License revoked: notice", description: "Emails the customer when an administrator revokes a license. Off by default.", trigger: "license.revoked", conditions: [], actions: email("license_revoked"), status: "paused" },
];

export async function installDefaults(repo: AutomationRepo, actorId: string | null): Promise<{ templates: number; workflows: number }> {
  let templates = 0;
  let workflows = 0;
  const ids = new Map<string, string>();
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await repo.findTemplateByKey(t.key);
    if (existing) {
      ids.set(t.key, existing.id);
      continue;
    }
    const made = await repo.insertTemplate({ template_key: t.key, name: t.name, subject: t.subject, body: t.body, active: true, created_by: actorId, updated_by: actorId });
    ids.set(t.key, made.id);
    templates++;
  }
  const idOf = (k: string) => ids.get(k) ?? "";
  for (const w of DEFAULT_WORKFLOWS) {
    if (await repo.findWorkflowByKey(w.key)) continue;
    await repo.insertWorkflow({ workflow_key: w.key, name: w.name, description: w.description, trigger_event: w.trigger, conditions: w.conditions, actions: w.actions(idOf), status: w.status, max_attempts: 4, cooldown_hours: w.cooldown_hours ?? 0, created_by: actorId, updated_by: actorId });
    workflows++;
  }
  if (templates || workflows) await repo.addAudit({ actor_id: actorId, action: "defaults_installed", target_type: null, target_id: null, detail: { templates, workflows } });
  return { templates, workflows };
}
