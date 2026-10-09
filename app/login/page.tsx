import { signIn } from "@/lib/auth-actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold">Monarch Tax Suite</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your workspace</p>
        </div>

        <form action={signIn} className="space-y-4 rounded-lg border border-border bg-surface p-6">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />

          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" defaultValue="info@monarchtaxsuite.com" required />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>

          {error && (
            <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
