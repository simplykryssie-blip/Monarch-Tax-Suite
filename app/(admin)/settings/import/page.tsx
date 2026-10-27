import { redirect } from "next/navigation";

/** Importing now happens on Contacts, where the people land. */
export default function ImportRedirect() {
  redirect("/contacts/import");
}
