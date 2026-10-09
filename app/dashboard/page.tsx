import { redirect } from "next/navigation";

// The admin workspace currently lives at the root route. Keep authentication
// redirects landing on that workspace until the dashboard is split into routes.
export default function DashboardPage() {
  redirect("/");
}
