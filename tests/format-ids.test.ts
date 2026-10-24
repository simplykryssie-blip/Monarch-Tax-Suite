import assert from "node:assert/strict";
import test from "node:test";
import { formatAddress, formatCaf, formatEfin, formatEin, formatPhone, formatPtin, formatSsn, formatZip } from "../lib/format/ids.ts";

test("phone numbers are written (555) 123-4567 as they are typed", () => {
  assert.equal(formatPhone(""), "");
  assert.equal(formatPhone("5"), "(5");
  assert.equal(formatPhone("5551"), "(555) 1");
  assert.equal(formatPhone("5551234567"), "(555) 123-4567");
  assert.equal(formatPhone("1-555-123-4567"), "(555) 123-4567");
  assert.equal(formatPhone("(555) 123-4567 ext 9"), "(555) 123-4567");
  assert.equal(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
});

test("SSN, ITIN, EIN, EFIN, PTIN, CAF and ZIP take the standard shape and are cut to length", () => {
  assert.equal(formatSsn("123456789"), "123-45-6789");
  assert.equal(formatSsn("12345"), "123-45");
  assert.equal(formatSsn("9991234567"), "999-12-3456");
  assert.equal(formatEin("123456789"), "12-3456789");
  assert.equal(formatEin("1"), "1");
  assert.equal(formatEfin("12-34 56789"), "123456");
  assert.equal(formatPtin("p01234567"), "P01234567");
  assert.equal(formatPtin("01234567"), "P01234567");
  assert.equal(formatPtin("p"), "P");
  assert.equal(formatPtin(""), "");
  assert.equal(formatCaf("123456789"), "1234-56789");
  assert.equal(formatCaf("1234"), "1234");
  assert.equal(formatZip("123456789"), "12345-6789");
  assert.equal(formatZip("12345"), "12345");
});

test("formatting is stable: formatting a formatted value changes nothing", () => {
  for (const [f, v] of [[formatPhone, "5551234567"], [formatSsn, "123456789"], [formatEin, "123456789"], [formatPtin, "P01234567"], [formatCaf, "123456789"], [formatZip, "123456789"]] as const) {
    assert.equal(f(f(v)), f(v));
  }
});

test("addresses are tidied; a careful mixed-case address is kept", () => {
  assert.equal(formatAddress("  123   main st ,  dallas, tx 75001 "), "123 Main St, Dallas, TX 75001");
  assert.equal(formatAddress("456 OAK AVE APT 2, HOUSTON, TX 770011234"), "456 Oak Ave APT 2, Houston, TX 77001-1234");
  assert.equal(formatAddress("789 McAllister Rd, Austin, tx 73301"), "789 McAllister Rd, Austin, TX 73301");
  assert.equal(formatAddress(""), "");
});

import { checkClient } from "../lib/workspace/rules.ts";

test("saving a client writes the phone and address the standard way and takes the last four from a full number", () => {
  const c = checkClient({ full_name: "Ada Lovelace", phone: "5551234567", address: "12 main st, dallas, tx 75001", ssn: "123-45-6789" });
  assert.equal(c.phone, "(555) 123-4567");
  assert.equal(c.address, "12 Main St, Dallas, TX 75001");
  assert.equal(c.ssn_last4, "6789");
  assert.equal("ssn" in c, false, "the full number is never part of the saved client row");
});

test("a client save without a full number keeps the last four it was sent, and a short full number is refused", () => {
  assert.equal(checkClient({ full_name: "Ada", ssn_last4: "4321" }).ssn_last4, "4321");
  assert.throws(() => checkClient({ full_name: "Ada", ssn: "12345" }), /nine digits/);
});
