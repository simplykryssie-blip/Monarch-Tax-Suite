import test from "node:test";
import assert from "node:assert/strict";
import { classifyHost, isBookingHost } from "../lib/sites/host.ts";

test("book.<domain> is a booking address; other addresses are not", () => {
  assert.ok(isBookingHost("book.monarchtaxsuite.com"));
  assert.ok(isBookingHost("BOOK.monarchtaxsuite.com:443"));
  assert.ok(!isBookingHost("book.com"));
  assert.ok(!isBookingHost("bookkeeping.example.com"));
  assert.ok(!isBookingHost("forms.monarchtaxsuite.com"));
  assert.ok(!isBookingHost(null));
});

test("a booking address is not an application address, so the proxy can give it the booking page", () => {
  assert.equal(classifyHost("book.monarchtaxsuite.com", { NEXT_PUBLIC_APP_URL: "https://app.verexahq.com" }).kind, "other");
});
