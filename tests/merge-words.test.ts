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

test("the email editor shows a merge tag as [Customer first name] and still saves the real tag", async () => {
  const { markdownToEditorHtml } = await import("../lib/richtext-editor.ts");
  const html = markdownToEditorHtml("Hi **{{customer_first_name}}**, your order {{order_number}} is ready.");
  assert.match(html, /data-token="customer_first_name"[^>]*>\[Customer first name\]<\/span>/);
  assert.match(html, /data-token="order_number"[^>]*>\[Order number\]<\/span>/);
  assert.ok(!html.includes("{{"), "no raw codes are shown");
  assert.match(markdownToEditorHtml("{{x_y}}", (n) => n.toUpperCase()), />\[X_Y\]</);
});
