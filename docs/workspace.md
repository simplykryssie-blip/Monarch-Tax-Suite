# My Workspace

The account holder's own practice. Four sub-tabs under **My Workspace**:

- **My Tax Office** (`/workspace`): returns in progress by stage, revenue snapshot (invoiced, collected, outstanding, overdue), deadlines (returns and tasks due in 30 days, and anything late) and quick actions. No team or firm records.
- **My Clients** (`/workspace/clients`): the client list and a profile per client with seven tabs: Overview, Documents, Messages, Work, Billing (with the $223 breakdown), Tasks and Notes.
- **My Work** (`/workspace/work`): a board of every return for a tax year, a column per stage of the default tax-return pipeline (Automation > Pipelines; the built-in stages are used until one exists). Extensions and amendments are cards of their own. Drag a card to move it; click it to open the client. Reaching the last stage stamps the filed date.
- **Billing** (`/workspace/billing`): every invoice, filterable by status (draft, sent, overdue, paid, void) and tax year, with revenue totals; new invoices default to the $223 breakdown ($79 + $21 + $24 + $99, from the fee template) and every line is editable.

## Bank statement import

`Billing > Import bank payments`: upload a bank CSV (Date, Description or Memo, Amount or Credit). Only money in is read. Each deposit is read for a tax year, the SSN's last 4 and a name, and matched to an open invoice:

- **Exact**: tax year, client name and last 4 all agree (a deposit that fits two invoices prefers the one whose balance equals the amount; a tie is downgraded to possible).
- **Possible**: the name plus one of the other two. For you to confirm.
- A different last 4 or tax year than the client's invoice is a contradiction, so no match.

Nothing is applied by reading the file. The review page lets you change the invoice or amount per row, ignore rows, save your edits, and apply only the ticked rows (exact matches start ticked). A row is applied at most once; a payment larger than the balance pays the invoice in full and the extra is not recorded (you're told). The same file uploaded twice is flagged.

## Data

Migration `20261027090000_workspace_clients_billing.sql`: `clients`, `client_returns`, `client_docs`, `client_messages`, `client_tasks`, `client_notes`, `invoices`, `payment_imports`, `payment_import_rows`, each with `tenant_id`, the two standard policies and same-tenant keys. Isolation gate: `supabase/tests/workspace_isolation.sql` (19 checks). Only the last 4 digits of an SSN are stored. Client files are in the private `tenant-documents` bucket under `{tenant}/clients/{client}/`, checked by content, and downloaded through one-minute links.

## Not built

Sending a message from a client's Messages tab (it logs what you sent or received); a client portal; e-filing. Use test or sample data until you are ready for real client records.
