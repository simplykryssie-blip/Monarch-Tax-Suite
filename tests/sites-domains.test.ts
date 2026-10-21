import assert from "node:assert/strict";
import test from "node:test";
import { cleanCustomHost, cleanLabel, dnsInstructions, isApex, labelFromName, platformDomain, subdomainHost } from "../lib/sites/domains.ts";
import { classifyHost, cleanRequestHost } from "../lib/sites/host.ts";

test("the platform domain is a setting with a safe default", () => {
  assert.equal(platformDomain({}), "sites.verexahq.com");
  assert.equal(platformDomain({ PLATFORM_SITE_DOMAIN: " VerexaHQ.com " }), "verexahq.com");
  assert.equal(platformDomain({ PLATFORM_SITE_DOMAIN: "not a domain" }), "sites.verexahq.com");
  assert.equal(subdomainHost("smith-tax", "verexahq.com"), "smith-tax.verexahq.com");
});

test("labels: made from names, checked, and the platform's own are reserved", () => {
  assert.equal(labelFromName("Smith & Sons Tax, LLC"), "smith-sons-tax-llc");
  assert.equal(labelFromName("AB"), "office-ab");
  assert.equal(labelFromName("!!!"), "office-site");
  assert.equal(labelFromName("x".repeat(80)).length <= 39, true);
  assert.equal(cleanLabel(" Smith-Tax "), "smith-tax");
  for (const bad of ["ab", "-bad", "bad-", "has space", "dots.dots", "dou--ble", "UPPER_case", "", null, "a".repeat(41)]) assert.throws(() => cleanLabel(bad), /3 to 40/, String(bad));
  for (const reserved of ["www", "app", "api", "book", "mail", "send", "admin", "verexa", "monarch"]) assert.throws(() => cleanLabel(reserved), /reserved/, reserved);
});

test("custom domains: cleaned, and the platform's own, hosting addresses and IPs refused", () => {
  assert.equal(cleanCustomHost("https://WWW.Smith-Tax.com/about?x=1"), "www.smith-tax.com");
  assert.equal(cleanCustomHost("smith-tax.com:443"), "smith-tax.com");
  for (const bad of ["", "nodots", "sites.verexahq.com", "x.sites.verexahq.com", "verexahq.com", "app.verexahq.com", "evil.vercel.app", "10.0.0.1", "a b.com", "-x.com", "x.c", "x.123", "foo.localhost", "foo.internal"]) assert.throws(() => cleanCustomHost(bad), /./, bad);
  assert.equal(cleanCustomHost("shop.monarchtaxsuite.com.evil.com"), "shop.monarchtaxsuite.com.evil.com");
  assert.throws(() => cleanCustomHost("x.verexahq.com", "verexahq.com"), /made for you/);
});

test("DNS instructions: A record for an apex, CNAME for a subdomain, TXT only when asked for", () => {
  assert.equal(isApex("smith-tax.com"), true);
  assert.equal(isApex("www.smith-tax.com"), false);
  assert.equal(isApex("smith-tax.co.uk"), true);
  assert.equal(isApex("www.smith-tax.co.uk"), false);
  assert.deepEqual(dnsInstructions("smith-tax.com").map((r) => [r.type, r.name, r.value]), [["A", "@", "76.76.21.21"]]);
  assert.deepEqual(dnsInstructions("www.smith-tax.com").map((r) => [r.type, r.name, r.value]), [["CNAME", "www", "cname.vercel-dns.com"]]);
  const withTxt = dnsInstructions("smith-tax.com", [{ type: "TXT", domain: "_vercel.smith-tax.com", value: "vc-domain-verify=x" }]);
  assert.equal(withTxt.length, 2);
  assert.equal(withTxt[1].type, "TXT");
});

test("host routing: the app never serves a site; office subdomains and other hosts are looked up", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://app.monarchtaxsuite.com", PLATFORM_SITE_DOMAIN: "monarchtaxsuite.com" };
  assert.deepEqual(classifyHost("app.monarchtaxsuite.com", env), { kind: "app" });
  assert.deepEqual(classifyHost("monarchtaxsuite.com", env), { kind: "app" });
  assert.deepEqual(classifyHost("www.monarchtaxsuite.com", env), { kind: "app" });
  assert.deepEqual(classifyHost("book.monarchtaxsuite.com", env), { kind: "app" });
  assert.deepEqual(classifyHost("monarch-tax-suite-git-x-verexa-hq-crm.vercel.app", env), { kind: "app" });
  assert.deepEqual(classifyHost("localhost:3000", env), { kind: "app" });
  assert.deepEqual(classifyHost("127.0.0.1", env), { kind: "app" });
  assert.deepEqual(classifyHost(null, env), { kind: "app" });
  assert.deepEqual(classifyHost("smith-tax.monarchtaxsuite.com", env), { kind: "platform-subdomain", host: "smith-tax.monarchtaxsuite.com", label: "smith-tax" });
  assert.deepEqual(classifyHost("SMITH-TAX.monarchtaxsuite.com:443", env), { kind: "platform-subdomain", host: "smith-tax.monarchtaxsuite.com", label: "smith-tax" });
  assert.deepEqual(classifyHost("a.b.monarchtaxsuite.com", env), { kind: "app" });
  assert.deepEqual(classifyHost("www.smith-tax.com", env), { kind: "other", host: "www.smith-tax.com" });
  assert.deepEqual(classifyHost("mkbfinancialgroup.com", { ...env, APP_HOSTS: "mkbfinancialgroup.com" }), { kind: "app" });
  assert.deepEqual(classifyHost("smith-tax.verexahq.com", { PLATFORM_SITE_DOMAIN: "verexahq.com" }), { kind: "platform-subdomain", host: "smith-tax.verexahq.com", label: "smith-tax" });
  assert.equal(cleanRequestHost("evil host"), null);
  assert.equal(cleanRequestHost("a.com, b.com"), "a.com");
});

test("the platform site domain defaults to Verexa HQ's and can be overridden", () => {
  assert.equal(platformDomain({}), "sites.verexahq.com");
  assert.equal(platformDomain({ PLATFORM_SITE_DOMAIN: "Example.com" }), "example.com");
  assert.deepEqual(classifyHost("smith-tax.sites.verexahq.com", { NEXT_PUBLIC_APP_URL: "https://app.verexahq.com" }), { kind: "platform-subdomain", host: "smith-tax.sites.verexahq.com", label: "smith-tax" });
  assert.deepEqual(classifyHost("app.verexahq.com", { NEXT_PUBLIC_APP_URL: "https://app.verexahq.com" }), { kind: "app" });
});
