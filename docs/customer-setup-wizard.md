# Customer setup wizard (`/integrations`)

Three plain steps. The customer types the license key on the page (never in chat); every action
resolves the license on the server from that key.

1. **Activate.** Customer enters their main website; any page URL or `www` address is reduced to the
   main domain (shared hosting addresses such as `*.vercel.app` or `*.myshopify.com` are refused).
   They review and confirm; only then is the domain authorized through the existing
   `authorizeDomain` rules (`max_domains`, active license only). The `www` twin is covered automatically.
2. **Choose where leads go.** *Connect GoHighLevel* (OAuth) when `HIGHLEVEL_CLIENT_ID` and
   `HIGHLEVEL_CLIENT_SECRET` are set. Until then the button is not shown, a plain notice says the
   one-click connection is not on yet, and the **Advanced** section offers the workflow-link (webhook)
   route. The signing secret appears only there.
3. **Test, then turn on.** *Test connection* must pass before lead capture can be enabled.

## What "Test connection" proves
- **GoHighLevel (OAuth):** the token works, the chosen location is readable, and one contact named
  "Monarch Connection Test" (tag `monarch-test`, no phone, `example.com` email) is created or found in the
  customer's own location. No email or text is sent.
- **Workflow link (webhook):** the address accepted a signed test event carrying one clearly fake sample lead (`Test Sample`, `test-sample@example.com`, `SAMPLE` estimate text). GoHighLevel's Inbound Webhook trigger refuses to save a workflow ("A Mapping Reference is required") until it has received a request, so the wizard tells the customer to: create the trigger and keep it open, save the link here, press Test connection, then in GoHighLevel press Test trigger and pick the received request as the Mapping Reference, add Create/Update Contact (and Send Email), and publish. Saving the link in Monarch never changes the customer's GoHighLevel link; it only issues a new signing secret. This does
  **not** prove the customer's workflow creates a contact or sends email; the message says so.

## Statuses
Not connected · Connected, not tested yet · Test failed · Test successful · Lead capture enabled.
A saved link or a fresh OAuth connection is "Connected, not tested yet", never a success.

## Not built / needs the owner
- **GoHighLevel Marketplace app** (not yet registered, so OAuth is untested live). Needed: a Marketplace
  app with sub-account (Location) install, redirect URL `https://<app origin>/api/integrations/crm/callback`
  (or `HIGHLEVEL_REDIRECT_URI`), scopes `contacts.readonly contacts.write locations.readonly`, and the app's
  client id and secret set as `HIGHLEVEL_CLIENT_ID` / `HIGHLEVEL_CLIENT_SECRET` in Vercel (server-only). The client id must be the full value GoHighLevel shows, including the suffix after the hyphen (e.g. `6aca…-mv2lh55c`). While the app version is not live (draft or in review) also set `HIGHLEVEL_VERSION_ID` to the `version_id=` value in the portal's install link; remove it once the app is live. Monarch's authorization link must match the portal's install link: `https://marketplace.gohighlevel.com/v2/oauth/chooselocation?response_type=code&redirect_uri=…&client_id=…&scope=…&version_id=…`.
  Marketplace review or approval may be required by GoHighLevel for public installs.
- Follow-up emails and workflow triggers remain the customer's own GoHighLevel workflow; Monarch does
  not send email and cannot verify that a workflow ran.
- No database migration is included. Rate limiting stays inactive until `20261009200000_rate_limit_counters.sql` is applied.
