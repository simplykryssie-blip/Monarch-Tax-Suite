import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { blockHtml, parseRich, richToText, tokensIn } from "../lib/richtext.ts";
import { renderTemplate, SAMPLE_VALUES } from "../lib/automation/template.ts";

// Email templates and form paragraphs are stored as Markdown and rendered through a strict, safe subset.

const html = (md: string, values: Record<string, string> = {}) => parseRich(md).map((b) => blockHtml(b, (n) => values[n] ?? "")).join("");

describe("rich text", () => {
  test("headings, bold, italic, underline, lists and links", () => {
    const out = html("# Welcome\n\n## Next\n\n**Bold** and *italic* and ++under++\n\n- one\n- two\n\n1. first\n2. second\n\n[site](https://example.com/a?b=1&c=2)");
    assert.match(out, /<h2[^>]*>Welcome<\/h2>/);
    assert.match(out, /<h3[^>]*>Next<\/h3>/);
    assert.match(out, /<strong>Bold<\/strong> and <em>italic<\/em> and <u>under<\/u>/);
    assert.match(out, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(out, /<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(out, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2"/);
  });

  test("colour and size spans accept only a hex colour and 10 to 40 px", () => {
    assert.match(html("[Big]{color=#B00020 size=24}"), /color:#b00020;font-size:24px;/);
    assert.equal(html("[x]{color=red size=99}"), '<p style="margin:0 0 14px;line-height:1.6">[x]{color=red size=99}</p>');
    assert.ok(!html("[x]{color=#fff;background:url(x) size=18}").includes("url("));
  });

  test("links and pictures need https; script and javascript links are plain text", () => {
    assert.ok(!/<a /.test(html("[bad](javascript:alert(1))")));
    assert.ok(!/<a /.test(html("[bad](http://example.com)")));
    assert.match(html("![logo](https://example.com/l.png)"), /<img src="https:\/\/example.com\/l.png" alt="logo"/);
    assert.ok(!/<img /.test(html("![x](data:image/png;base64,AAAA)")));
  });

  test("HTML typed into a message is shown as text, never run", () => {
    const out = html('<script>alert(1)</script> <b onclick="x">hi</b>');
    assert.ok(!out.includes("<script"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  test("a placeholder value cannot add formatting, links or markup", () => {
    const out = html("Hello {{customer_name}}", { customer_name: "**x** [y](https://evil.example) <img src=x>" });
    assert.ok(!/<strong>|<a |<img/.test(out));
    assert.ok(out.includes("&lt;img src=x&gt;"));
  });

  test("placeholders are found, and plain text drops the markup but keeps link addresses", () => {
    const blocks = parseRich("Hi **{{customer_first_name}}**, see [the page](https://example.com).");
    assert.deepEqual(tokensIn(blocks), ["customer_first_name"]);
    assert.equal(richToText(blocks, { customer_first_name: "Ann" }), "Hi Ann, see the page (https://example.com).");
  });

  test("the email renderer uses it end to end and still rejects an unknown placeholder", () => {
    const mail = renderTemplate("Hello {{customer_first_name}}", "# Hi\n\nYour order **{{order_number}}** is [ready](https://example.com/o).", SAMPLE_VALUES, { supportEmail: "s@example.com" });
    assert.match(mail.html, /<strong>1000<\/strong>/);
    assert.match(mail.text, /Your order 1000 is ready \(https:\/\/example.com\/o\)\./);
    assert.throws(() => renderTemplate("x", "{{nope}}", SAMPLE_VALUES, { supportEmail: "s@example.com" }), /Unknown template variable/);
  });
});
