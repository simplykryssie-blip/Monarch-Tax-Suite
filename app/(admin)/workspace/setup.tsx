export function WorkspaceSetup({ message }: { message: string }) {
  return (
    <div className="monarch-notice">
      <b>DATABASE SETUP REQUIRED</b> My Workspace needs its tables. Apply <code>supabase/migrations/20261027090000_workspace_clients_billing.sql</code>, then reload. Nothing else is affected. <small>({message})</small>
    </div>
  );
}
