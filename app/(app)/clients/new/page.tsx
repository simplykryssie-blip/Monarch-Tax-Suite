import { createClientRecord } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/field";

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-semibold">New client</h1>

      <Card>
        <CardContent>
          <form action={createClientRecord} className="space-y-4">
            <div>
              <Label htmlFor="client_type">Client type</Label>
              <Select id="client_type" name="client_type" defaultValue="individual">
                <option value="individual">Individual</option>
                <option value="business">Business</option>
                <option value="trust">Trust</option>
                <option value="estate">Estate</option>
                <option value="organization">Organization</option>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="first_name">First name</Label>
                <Input id="first_name" name="first_name" placeholder="For individuals" />
              </div>
              <div>
                <Label htmlFor="last_name">Last name</Label>
                <Input id="last_name" name="last_name" placeholder="For individuals" />
              </div>
            </div>

            <div>
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" placeholder="For businesses, trusts, etc." />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="primary_email">Email</Label>
                <Input id="primary_email" name="primary_email" type="email" />
              </div>
              <div>
                <Label htmlFor="primary_phone">Phone</Label>
                <Input id="primary_phone" name="primary_phone" type="tel" />
              </div>
            </div>

            {error && <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>}

            <Button type="submit">Create client</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
