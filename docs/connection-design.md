# ERO / Service Bureau → PTIN connection: design decisions (Krystal)

Recorded against the "ERO/Bureau to PTIN connection" item. **Not built.** One decision is still open (below).

## Decided
- **The PTIN keeps their own workspace.** A connection shares only what the PTIN chooses to share upward.
- **One connection only.** A PTIN is connected to one ERO or one Service Bureau: not both, not two of either.
- **Either side can end it.**
- **The PTIN chooses what to share, per client**: select several clients at once, or share them one by one.
- **Sharing a client shares exactly three things**: the client's information, the client's documents, and the notes. Nothing else.
- **Downward sharing**: when the ERO/bureau shares a client with its connected PTIN, the PTIN has the option to save that client's documents (they need the documents; the client need not become one of their own contacts).
- **The ERO/bureau side gets a dedicated section** for documents belonging to clients that connected PTINs shared with them.
- Sending connections is the ERO/bureau's side only; accepting is the PTIN's (see `ptin-product-requirements.md`, items 3 and 4).

## Still open (do not guess)
- **What happens to in-progress work if a connection ends mid-season.** Krystal is deciding.

## Open design item (separate): lead documents
- Leads have no Documents today. Krystal is weighing a dedicated lead-documents section whose documents transfer to the client
  record when a lead converts. Until that is decided, a form PDF can be filed only under a **client**; a respondent who is a lead or
  a new person has nowhere to file it (the PDF stays on the submission, and the submission records "client_file_skipped").

## Build rule
Every part of this is tenant-wide platform code, with the same tenant separation as the rest of the system (Message 139).
