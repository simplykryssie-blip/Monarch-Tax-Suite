# Importing from GoHighLevel (and other CRMs)

Goal: a tenant can bring their GoHighLevel (GHL) data into their workspace. Built in pieces; each is its own pull request.

## What is built (branch `claude/ghl-import`)

**Where:** the person chooses where it goes and what kind of file it is, sees a preview, then confirms. Nothing is saved before that, and the same file is sent again to confirm, so nothing is held on the server in between.
- PTIN workspace and office area: **My Clients, Import**. Clients only.
- Main account admin: **Settings, Import data**. Clients, Leads (Service Bureau), Store customers (Service Bureau) and Firms (Service Bureau), as the account's tier allows. Each action re-checks the signed-in person and the destination's part of the app.

**Three kinds of file**
1. **People** (a contact list, GoHighLevel's "Export contacts" works as is). Name, email, phone, address, tags and a Notes column, where the destination keeps them.
2. **Notes** for people already added: one note per row, matched by email, phone or (for firms) name. The note's original date goes in its text.
3. **Messages** for people already added (clients only): direction, channel (email, text, call), subject, body, date. Saved as history only ("logged"); nothing is sent and no automation runs.

| Destination | Keeps | Needs | Told apart by |
|---|---|---|---|
| Clients | name, email, phone, address, tags, notes, messages | email or phone | email or phone, incl. archived |
| Leads | name, email, phone, firm name, tags, notes | email | email |
| Store customers | name, email | email | email |
| Firms (EROs & EFINs) | legal name, DBA, address, notes (email and phone go into the note) | name | name |

**Tags:** tags are plain labels on each record, not a separate list, so importing a tag creates it. The preview and the result say which tags are new and which already existed (checked against the clients' and leads' tags in use). The tag limits stay: 12 per person, 40 characters each. Store customers and firms keep no tags, and say so.

**Safety:** columns that look like SSN, tax IDs, birth dates or bank details are never imported and are named. Imported people are not marked as agreeing to marketing email or text. Messages are never sent. The history (clients area) records counts only.

**Limits:** 2,000 rows (5,000 for notes or messages) and 2 MB per file. Running it again adds nobody twice.

## Not built
- Direct pull from GoHighLevel through the API (needs the read scopes on the GHL app and the app review; to verify against GHL's current docs).
- Pipelines (stage names and order) and forms/automations (as far as we know GHL's API lists workflows but not their steps, so a guided rebuild checklist is the likely answer; to verify).
- Lead messages (leads have no message history to hold them).
- The admin area's import history: counts are recorded for the PTIN workspace and office area only.

## Decisions for the owner
- Direct GHL pull versus CSV only for launch.
- Whether leads should get a message history, so GHL conversations on leads can be kept.
