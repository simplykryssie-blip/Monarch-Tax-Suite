# Importing from GoHighLevel (and other CRMs)

Goal: a tenant can bring their GoHighLevel (GHL) data into their workspace. Built in pieces; each is its own pull request.

## Piece 1 (built): client import from CSV
- **Where:** My Clients, "Import clients", in every area that has clients (PTIN workspace, office area).
- **Source:** GHL's contact export (Contacts, choose contacts, Export as CSV), or any CSV with a name column and an email or phone column. GHL's headings are recognised: Contact Name, First Name, Last Name, Business Name, Phone, Email, Tags, Address1, City, State, Postal Code.
- **Preview first:** the person sees how many would be added, a sample, the rows left out and why, and which columns were used, ignored or left out on purpose. Nothing is saved until they confirm. The same file is sent again to confirm, so nothing is held on the server in between.
- **Matching:** by email (case-insensitive) or phone (last ten digits, any format), against everyone already in the account or office including archived clients, and within the file. A row matching a known person still makes its other details count as known.
- **Never imported:** columns that look like SSN, tax IDs, date of birth, bank or card details. They are named to the person and ignored.
- **Tags:** the person's GHL tags are kept (up to 12 per client), plus an optional tag for the whole import.
- **Consent:** imported people are not marked as agreeing to marketing email or text. Consent stays a separate step in Campaigns.
- **Ownership:** imported clients belong to the person importing, in their office, like clients added by hand.
- **History:** records how many were added, skipped and failed, never names or contact details.
- **Limits:** 2,000 rows and 2 MB per file. Running it again adds nobody twice.

## Next pieces (not built)
2. **Leads CSV import for every tier** (today only Service Bureau accounts have the Leads page), reusing the same matching.
3. **Pipelines:** import stage names and order from a GHL pipeline export, or by typing them, into the tenant's pipelines.
4. **Direct pull from GHL** through the existing connection: contacts, tags, custom fields, pipelines and opportunities. Needs the read scopes added to the GHL app (today: contacts.readonly, contacts.write, locations.readonly) and the GHL Marketplace app review finished; existing connections would have to approve the new scopes. To verify against GHL's current API docs before building.
5. **Forms and automations:** a guided "rebuild" checklist listing what they had in GHL and the matching tool here. As far as we know GHL's API lists workflows but doesn't give their steps, so a true automation import isn't expected to be possible; to verify.

## Decisions for the owner
- Which tenants first for piece 2 and the order of pieces 3 to 5.
- Whether the direct pull (piece 4) is worth waiting on the GHL app review, or CSV is enough to launch.
