import assert from "node:assert/strict";
import test from "node:test";
import { confirmKind, confirmText } from "../lib/ui/confirm.ts";

test("destructive labels ask first, and permanent ones say so", () => {
  for (const l of ["Delete", "Delete campaign", "Delete anyway", "Void", "Discard this import", "Revoke", "Disconnect domain", "Merge"]) assert.equal(confirmKind(l, false), "permanent", l);
  for (const l of ["Archive", "Archive this client", "Restore", "Withdraw invite", "Take offline", "Cancel invite", "Remove"]) assert.notEqual(confirmKind(l, false), null, l);
  assert.equal(confirmKind("Remove", false), "permanent");
  assert.equal(confirmKind("Restore", false), "normal");
});

test("ordinary buttons run straight away", () => {
  for (const l of ["Save", "Send", "Add client", "New invoice", "Publish", "Record payment", "Cancel", "Show"]) assert.equal(confirmKind(l, false), null, l);
});

test("a button styled as dangerous asks even if its label is unusual", () => {
  assert.equal(confirmKind("Stop sending", true), "normal");
  assert.equal(confirmKind("", true), "normal");
  assert.equal(confirmKind("", false), null);
});

test("the dialog sentence names the action", () => {
  assert.equal(confirmText("Delete campaign", "permanent"), "Are you sure you want to delete campaign? This cannot be undone.");
  assert.equal(confirmText("Archive…", "normal"), "Are you sure you want to archive?");
});
