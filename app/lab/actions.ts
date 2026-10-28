"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/lib/commerce/validation";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit";
import { rateLimitStore } from "@/lib/rate-limit-server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/admin";
import { currentUser, labCommerce, labContext, labRepo } from "@/lib/lab/server";
import {
  acceptInvite, activateKey, gradeWork, inviteStudents, reissueInvite, removeStudent, runCheck, saveDraft, saveScenario,
  submitWork, canEditScenario, type ScenarioForm,
} from "@/lib/lab/service";

// Server actions for the Monarch Tax Lab. Each one finds who is signed in and lets lib/lab/service.ts decide what they
// may do; nothing here trusts the browser beyond the values it sends.

type Fail = { error: string };
const message = (e: unknown) => (e instanceof ValidationError ? e.message : "Something went wrong. Please try again.");
function failed(e: unknown): Fail {
  if (!(e instanceof ValidationError)) console.error(`lab: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
  return { error: message(e) };
}

async function ctxOrFail() {
  const ctx = await labContext();
  if (!ctx) throw new ValidationError("Your session ended. Sign in again.");
  return ctx;
}

// ------------------------------------------------------------------ practice

export async function saveDraftAction(scenarioId: string, ret: unknown, intake: unknown): Promise<{ savedAt: string } | Fail> {
  try {
    const w = await saveDraft(labRepo(), await ctxOrFail(), scenarioId, ret, intake);
    return { savedAt: w.updated_at };
  } catch (e) {
    return failed(e);
  }
}

export async function checkAction(scenarioId: string, ret: unknown, intake: unknown) {
  try {
    return await runCheck(labRepo(), await ctxOrFail(), scenarioId, ret, intake);
  } catch (e) {
    return failed(e);
  }
}

export async function submitAction(scenarioId: string, ret: unknown, intake: unknown, note: string) {
  try {
    const w = await submitWork(labRepo(), await ctxOrFail(), scenarioId, ret, intake, note, new Date());
    revalidatePath("/lab");
    return { submittedAt: w.submitted_at, correct: w.correct, total: w.total };
  } catch (e) {
    return failed(e);
  }
}

// ------------------------------------------------------------------ scenarios

export async function saveScenarioAction(form: ScenarioForm): Promise<{ id: string } | Fail> {
  try {
    const s = await saveScenario(labRepo(), await ctxOrFail(), form, new Date());
    revalidatePath("/lab");
    return { id: s.id };
  } catch (e) {
    return failed(e);
  }
}

export async function deleteScenarioAction(formData: FormData) {
  const ctx = await ctxOrFail();
  const repo = labRepo();
  const s = await repo.getScenario(String(formData.get("id") ?? ""));
  if (!s || !canEditScenario(ctx, s)) redirect("/lab?error=" + encodeURIComponent("You can't delete that scenario."));
  if (formData.get("confirm") !== "yes") redirect(`/lab/scenarios/${s.id}?error=` + encodeURIComponent("Tick the box to confirm the deletion."));
  await repo.deleteScenario(s.id);
  revalidatePath("/lab");
  redirect("/lab?notice=" + encodeURIComponent("Scenario deleted."));
}

// ------------------------------------------------------------------ roster

export type InviteState = { error?: string; links?: { email: string; url: string }[] };

export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  try {
    const ctx = await ctxOrFail();
    if (!ctx.membership) throw new ValidationError("Only instructors can invite students.");
    const invites = await inviteStudents(labRepo(), ctx.membership, String(formData.get("emails") ?? ""), new Date());
    const origin = await appOrigin();
    revalidatePath("/lab/roster");
    return { links: invites.map((i) => ({ email: i.email, url: `${origin}/lab/join/${i.token}` })) };
  } catch (e) {
    return failed(e);
  }
}

export async function reissueAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  try {
    const ctx = await ctxOrFail();
    if (!ctx.membership) throw new ValidationError("Only instructors can invite students.");
    const memberId = String(formData.get("member_id") ?? "");
    const token = await reissueInvite(labRepo(), ctx.membership, memberId, new Date());
    const m = await labRepo().getMember(memberId);
    return { links: [{ email: m?.email ?? "", url: `${await appOrigin()}/lab/join/${token}` }] };
  } catch (e) {
    return failed(e);
  }
}

export async function removeStudentAction(formData: FormData) {
  const ctx = await ctxOrFail();
  try {
    if (!ctx.membership) throw new ValidationError("Only instructors can manage students.");
    await removeStudent(labRepo(), ctx.membership, String(formData.get("member_id") ?? ""));
  } catch (e) {
    redirect("/lab/roster?error=" + encodeURIComponent(message(e)));
  }
  revalidatePath("/lab/roster");
  redirect("/lab/roster?notice=" + encodeURIComponent("Student removed. Their seat is free."));
}

export async function gradeAction(formData: FormData) {
  const workId = String(formData.get("work_id") ?? "");
  try {
    await gradeWork(labRepo(), await ctxOrFail(), workId, { grade: String(formData.get("grade") ?? ""), score: String(formData.get("score") ?? ""), feedback: String(formData.get("feedback") ?? "") }, new Date());
  } catch (e) {
    redirect(`/lab/review/${workId}?error=` + encodeURIComponent(message(e)));
  }
  revalidatePath("/lab/review");
  redirect(`/lab/review/${workId}?notice=` + encodeURIComponent("Grade saved. The student sees it on their Check & submit tab."));
}

// ------------------------------------------------------------------ activation and joining (public pages)

/** Limits account creation and key guessing per visitor address. */
async function limited(bucket: string): Promise<boolean> {
  const ip = clientAddress((await headers()).get("x-forwarded-for"));
  if (!ip) return false;
  try {
    const hits = await rateLimitStore().hit(`${bucket}:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso);
    return hits > 8;
  } catch {
    return false; // the counter store may not be installed; Supabase still limits sign-ups.
  }
}

/**
 * Creates the account (or uses the signed-in one) and activates the license key. If the project requires email
 * confirmation, the activation is still recorded against the new account, and the person signs in after confirming
 * (the confirmation link lands on the sign-in page, which then opens the lab).
 */
export async function activateAction(formData: FormData) {
  const back = (msg: string): never => redirect("/lab/activate?error=" + encodeURIComponent(msg));
  if (await limited("lab-activate")) back("Too many attempts. Please wait a minute and try again.");
  const rawKey = String(formData.get("key") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  let user = await currentUser();
  let confirmEmail = false;
  if (!user) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
    const password = String(formData.get("password") ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back("Enter a valid email address.");
    if (password.length < 12) back("Choose a password of at least 12 characters.");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${await appOrigin()}/login?next=/lab`, data: { full_name: name } } });
    if (error) back(error.message.includes("registered") ? "An account with that email already exists. Sign in first, then activate your key." : "The account could not be created. Try a longer password or another email.");
    // An existing address comes back as a user with no identities: never attach a key to someone else's account.
    if (!data.user || (data.user.identities ?? []).length === 0) back("An account with that email already exists. Sign in first, then activate your key.");
    user = data.user;
    confirmEmail = !data.session;
  }
  try {
    await activateKey(labRepo(), labCommerce(), { rawKey, userId: user!.id, email: user!.email ?? String(formData.get("email") ?? ""), displayName: name || null, now: new Date() });
  } catch (e) {
    back(message(e));
  }
  if (confirmEmail) redirect("/lab/activate?confirm=1");
  redirect("/lab?notice=" + encodeURIComponent("Your license is active. Welcome to Monarch Tax Lab."));
}

export async function joinAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (msg: string): never => redirect(`/lab/join/${encodeURIComponent(token)}?error=` + encodeURIComponent(msg));
  if (await limited("lab-join")) back("Too many attempts. Please wait a minute and try again.");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  let user = await currentUser();
  let confirmEmail = false;
  if (!user) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
    const password = String(formData.get("password") ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back("Enter a valid email address.");
    if (password.length < 12) back("Choose a password of at least 12 characters.");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${await appOrigin()}/login?next=/lab`, data: { full_name: name } } });
    if (error || !data.user || (data.user.identities ?? []).length === 0) back("An account with that email already exists. Sign in first, then open your invitation link again.");
    user = data.user;
    confirmEmail = !data.session;
  }
  try {
    await acceptInvite(labRepo(), token, { id: user!.id, email: user!.email ?? "", displayName: name || null }, new Date());
  } catch (e) {
    back(message(e));
  }
  if (confirmEmail) redirect("/lab/activate?confirm=1");
  redirect("/lab?notice=" + encodeURIComponent("You joined your class. Pick a scenario to start."));
}
