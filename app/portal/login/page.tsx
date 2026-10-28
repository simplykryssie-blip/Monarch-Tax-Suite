import { redirect } from "next/navigation";

// The address a client is most likely to try. The one sign-in page serves them; `next` makes it speak to clients.
export default function PortalLogin() {
  redirect("/login?next=/portal");
}
