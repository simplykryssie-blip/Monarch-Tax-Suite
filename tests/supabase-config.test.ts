import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseUrl, supabaseConfigProblems } from "../lib/supabase/config.ts";

const TEST_URL = "https://riuylqgpebchhinybxxz.supabase.co";
const PROD_URL = "https://ftthniovwzxztkwtregz.supabase.co";

test("preview with no Supabase variables reports both missing names and never falls back to production", () => {
  const env = { VERCEL_ENV: "preview" };
  assert.equal(resolveSupabaseUrl(env), "");
  assert.deepEqual(supabaseConfigProblems(env), [
    "NEXT_PUBLIC_SUPABASE_URL is not set for this environment.",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set for this environment.",
  ]);
});

test("preview configured for the test project is accepted", () => {
  assert.deepEqual(supabaseConfigProblems({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: TEST_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }), []);
});

test("preview pointed at production is refused", () => {
  const problems = supabaseConfigProblems({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" });
  assert.match(problems.join(" "), /points to the production project/);
});

test("a key alone on preview does not silently use the production URL", () => {
  const problems = supabaseConfigProblems({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" });
  assert.deepEqual(problems, ["NEXT_PUBLIC_SUPABASE_URL is not set for this environment."]);
});

test("production behaviour is unchanged: configured values work, and the production URL fallback remains", () => {
  assert.deepEqual(supabaseConfigProblems({ VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }), []);
  assert.equal(resolveSupabaseUrl({ VERCEL_ENV: "production" }), PROD_URL);
});

test("local runs must name their project explicitly", () => {
  assert.equal(resolveSupabaseUrl({}), "");
  assert.equal(supabaseConfigProblems({ NEXT_PUBLIC_SUPABASE_URL: TEST_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }).length, 0);
});

test("messages never contain variable values", () => {
  const secret = "sb_publishable_SECRETVALUE";
  const problems = supabaseConfigProblems({ VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret });
  assert.ok(!problems.join(" ").includes(secret));
  assert.ok(!problems.join(" ").includes(PROD_URL));
});
