import assert from "node:assert/strict";
import test from "node:test";
import { EMBED_ID_PATTERN, embedIdVariants, generateEmbedId } from "../lib/commerce/embed.ts";

test("new embed ids never contain letters and digits that look alike, and still match the id pattern", () => {
  for (let i = 0; i < 200; i++) {
    const id = generateEmbedId();
    assert.match(id, EMBED_ID_PATTERN);
    assert.doesNotMatch(id.slice(4), /[01lIO]/);
  }
});

test("a calculator code copied with a '1' for an 'l' is still found", () => {
  const real = "emb_NlShYHDPnWP5Wa-GJU6IIw";
  const typed = "emb_N1ShYHDPnWP5Wa-GJU6IIw";
  assert.ok(embedIdVariants(typed).includes(real));
  assert.ok(!embedIdVariants(typed).includes(typed), "the exact spelling is tried first, not repeated");
});

test("an id with nothing to swap, or far too many look-alikes, tries nothing extra", () => {
  assert.deepEqual(embedIdVariants("emb_ABCDEFGHJKLMNPQRSTUVWX"), []);
  assert.deepEqual(embedIdVariants(`emb_${"1".repeat(22)}`), []);
});
