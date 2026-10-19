import assert from "node:assert/strict";
import test from "node:test";
import { hashRecipientToken, linkTable, messageProblems, recipientToken, renderEmail, renderSmsBody, SAMPLE_CAMPAIGN_VALUES, smsSegments, subjectProblems, TOKEN_SHAPE, unknownCampaignVariables, valuesFor } from "../lib/campaigns/compose.ts";

const brand = { name: "Sample Tax Office", color: "#07101e", textColor: "#ffffff", logoUrl: null };
const base = { subject: "Your 2026 checklist, {{first_name}}", body: "Hi {{first_name}},\n\nSee [our checklist](https://example.com/list) or [call us](tel:5550100000).\n\n**Thanks**", values: SAMPLE_CAMPAIGN_VALUES, brand, address: "1 Example St\nSpringfield, ST 00000", unsubscribeUrl: "https://app.example.com/u/TOKEN", trackLink: null, openPixel: null };

test("merge fields: a fixed list; unknown ones are caught; names fall back to 'there'", () => {
  assert.deepEqual(unknownCampaignVariables("Hi {{first_name}} {{ nme }} {{x_y}}"), ["nme", "x_y"]);
  assert.equal(valuesFor({ name: "  Jane   Q Public " }, { name: "Office", phone: null, email: null }).first_name, "Jane");
  assert.equal(valuesFor({ name: null }, { name: "Office", phone: null, email: null }).first_name, "there");
});

test("every email carries the office's address and an unsubscribe link, in HTML and text", () => {
  const e = renderEmail(base);
  assert.equal(e.subject, "Your 2026 checklist, Jane");
  assert.match(e.html, /Springfield, ST 00000/);
  assert.match(e.html, /href="https:\/\/app\.example\.com\/u\/TOKEN"[^>]*>Unsubscribe<\/a>/);
  assert.match(e.text, /Unsubscribe: https:\/\/app\.example\.com\/u\/TOKEN/);
  assert.match(e.text, /Sample Tax Office, 1 Example St, Springfield, ST 00000/);
  assert.match(e.html, /Hi Jane,/);
});

test("links are tracked through the platform; the unsubscribe link is not; other schemes are dropped", () => {
  const urls = linkTable(base.body);
  assert.deepEqual(urls, ["https://example.com/list"]);
  const e = renderEmail({ ...base, trackLink: (u) => `https://app.example.com/t/c/TOKEN/${urls.indexOf(u)}`, openPixel: "https://app.example.com/t/o/TOKEN.gif" });
  assert.match(e.html, /href="https:\/\/app\.example\.com\/t\/c\/TOKEN\/0"/);
  assert.ok(!e.html.includes("https://example.com/list"));
  assert.ok(!e.html.includes('href="tel:'), "a non-https link is never made a link");
  assert.match(e.html, /<img src="https:\/\/app\.example\.com\/t\/o\/TOKEN\.gif" width="1" height="1"/);
  assert.match(e.html, /href="https:\/\/app\.example\.com\/u\/TOKEN"/);
  assert.match(e.text, /\/t\/c\/TOKEN\/0/);
});

test("values can't inject markup or links", () => {
  const e = renderEmail({ ...base, values: { ...SAMPLE_CAMPAIGN_VALUES, first_name: '<script>alert(1)</script><a href="https://evil.test">x</a>' }, body: "Hi {{first_name}}" });
  assert.ok(!e.html.includes("<script>"));
  assert.ok(!e.html.includes('href="https://evil.test"'));
  assert.throws(() => renderEmail({ ...base, body: "Hi {{nope}}" }), /Unknown merge field/);
});

test("a preview says so; the logo only loads over https", () => {
  assert.match(renderEmail({ ...base, previewBanner: true }).html, /Nothing has been sent/);
  assert.ok(!renderEmail({ ...base, brand: { ...brand, logoUrl: "http://x.test/a.png" } }).html.includes("http://x.test"));
  assert.match(renderEmail({ ...base, brand: { ...brand, logoUrl: "https://x.test/a.png" } }).html, /<img src="https:\/\/x\.test\/a\.png"/);
});

test("honest subject lines", () => {
  assert.deepEqual(subjectProblems("Your return is ready"), []);
  assert.match(subjectProblems("RE: your invoice")[0], /Re: or Fwd:/);
  assert.match(subjectProblems("Fwd: documents")[0], /Re: or Fwd:/);
  assert.match(subjectProblems("LAST CHANCE TO FILE NOW")[0], /capital letters/);
  assert.deepEqual(subjectProblems("IRS"), []);
  assert.match(subjectProblems("  ")[0], /Write a subject/);
});

test("a campaign can't be scheduled without an address, a subject or a known merge field", () => {
  const ok = { channel: "email" as const, subject: "Hello", body: "Hi {{first_name}}" };
  assert.deepEqual(messageProblems(ok, { address: "1 Example St" }), []);
  assert.match(messageProblems(ok, { address: null }).join(" "), /mailing address/);
  assert.match(messageProblems({ ...ok, subject: "" }, { address: "x" }).join(" "), /subject/);
  assert.match(messageProblems({ ...ok, body: "Hi {{nme}}" }, { address: "x" }).join(" "), /Unknown merge field/);
  assert.match(messageProblems({ ...ok, body: "" }, { address: "x" }).join(" "), /Write the message/);
});

test("texts name the office, end with the opt-out, and are counted in message parts", () => {
  const v = SAMPLE_CAMPAIGN_VALUES;
  assert.equal(renderSmsBody("Hi {{first_name}}, your return is ready.", v), "Sample Tax Office: Hi Jane, your return is ready. Reply STOP to opt out.");
  assert.equal(renderSmsBody("Sample Tax Office: hello. Reply STOP to stop.", v), "Sample Tax Office: hello. Reply STOP to stop.");
  assert.deepEqual(smsSegments("a".repeat(160)), { segments: 1, encoding: "GSM-7", length: 160 });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("[").length, 2);
  assert.deepEqual(smsSegments("héllo ✓"), { segments: 1, encoding: "UCS-2", length: 7 });
  assert.equal(smsSegments("✓".repeat(71)).segments, 2);
  const long = { channel: "sms" as const, subject: null, body: "x".repeat(700) };
  assert.match(messageProblems(long, { address: null }).join(" "), /too long/);
  assert.deepEqual(messageProblems({ channel: "sms", subject: null, body: "Your return is ready." }, { address: null }), []);
});

test("link tokens: derived, not stored; only the hash is kept; the shape is checked", () => {
  const key = Buffer.alloc(32, 3);
  const t = recipientToken(key, "11111111-1111-4111-8111-111111111111");
  assert.match(t, TOKEN_SHAPE);
  assert.equal(t, recipientToken(key, "11111111-1111-4111-8111-111111111111"));
  assert.notEqual(t, recipientToken(key, "22222222-2222-4222-8222-222222222222"));
  assert.notEqual(t, recipientToken(Buffer.alloc(32, 4), "11111111-1111-4111-8111-111111111111"));
  assert.match(hashRecipientToken(t), /^[0-9a-f]{64}$/);
  assert.equal(TOKEN_SHAPE.test("short"), false);
});
