import { redirect } from "next/navigation";

// History moved under Settings.
export default function OldHistory() {
  redirect("/bureau/settings/history");
}
