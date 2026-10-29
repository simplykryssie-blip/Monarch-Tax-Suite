import test from "node:test";
import assert from "node:assert/strict";
import { fromFriendlyWith, toFriendlyWith } from "../lib/ui/merge-words.ts";
import { CAMPAIGN_WORDS } from "../lib/campaigns/words.ts";
import { CAMPAIGN_VARIABLES } from "../lib/campaigns/compose.ts";

test("campaign messages round-trip between merge tags and the words people see", () => {
  const stored = "Hi {{first_name}}, call {{office_phone}} or see [our page](https://x.test). {{mystery}}";
  const friendly = toFriendlyWith(CAMPAIGN_WORDS, stored);
  assert.equal(friendly, "Hi [First name], call [Office phone] or see [our page](https://x.test). {{mystery}}");
  assert.equal(fromFriendlyWith(CAMPAIGN_WORDS, friendly), stored);
});

test("every campaign merge tag has a friendly word", () => {
  assert.deepEqual(CAMPAIGN_WORDS.map((w) => w.key).sort(), Object.keys(CAMPAIGN_VARIABLES).sort());
});
