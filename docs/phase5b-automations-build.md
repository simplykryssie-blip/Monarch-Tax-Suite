# Phase 5b — Automations (build notes)

Branch `claude/phase5b-automations`, built on 5a (PR #66) and 5.0 (PR #65). Merge those first.

## What it adds
- **A step tree instead of a flat list.** A workflow's steps are actions, **waits** and **If / else** branches (each branch holds its own steps). Limits: 25 steps in all (counting steps inside branches), If / else up to 3 levels deep.
- **Waits** in minutes, hours or days, either *business time* (only the office's open hours, closed weekdays and holidays from Settings → Business hours) or *calendar time*. A run that reaches a wait is saved as **waiting** with a wake-up time; the 5-minute tick carries it on. Attempts start over after a wait, so a long workflow never runs out of tries for its later steps. If the workflow is paused when a run wakes, the run is skipped (and can be retried after turning the workflow on).
- **If / else** tests the person (tags, lead status, is a lead, is a client) and the event's own fields. Each run records which path it took ("Conditions met: took the Yes path").
- **New steps:** create a task (Automation → Tasks), add / remove a tag, change a lead's status, send a text. A text is sent only to a person with consent on record (today: an appointment booked with the text-reminder box ticked) and a mobile number, from the office's own number and credits; anyone else is skipped with the reason in the run history.
- **New triggers:** appointment booked / rescheduled / cancelled / attended / no-show (now about a person, so a workflow can email them), invoice paid, invoice overdue (raised once per invoice from 8 am office time), tag added / removed (by a person, never by a workflow), return moved to a new stage, and **days before / after a return's due date** (set the number of days on the workflow).
- **People:** events record only *what they are about* (an appointment, lead, client, invoice or return, by id). The person's name, email and number are looked up when a step runs. Email steps go to that person; templates gain `{{appointment_time}}`, `{{appointment_type}}`, `{{appointment_link}}`, `{{invoice_number}}`, `{{invoice_total}}`, `{{invoice_due}}`.
- **Tests:** Run a safe test and Test with a client now walk the whole tree. Waits are skipped, the branch taken is recorded, and no step changes a person, makes a task or sends anything.
- **Builder:** the five fixed rows are replaced by a step builder (add, reorder, remove, nest). Workflows made before this change open as a list of steps and keep working; saving converts them.
- **Install defaults** is still per office and by key, so installing twice never duplicates.

## Safeguards
- A workflow can't start another workflow through its own tag changes (tag events come only from people).
- A task is made once per run even if its step is retried (unique per run and title).
- Reruns after a failure resume at the step that failed; steps already done are never repeated (an email that went out is not sent again).

## Tables and columns (tenant_id from day one; same-tenant foreign keys)
`automation_workflows.steps` / `.trigger_config`; `automation_events.subject_type` / `.subject_id`; `automation_executions.pc` and the `waiting` status; `clients.tags`; new table `automation_tasks`. Migration `20261110090000_automation_steps.sql`. Gate: `supabase/tests/phase5b_isolation.sql` (27 checks).

## Not in 5b
Per-person texting consent beyond appointments (leads and clients have no consent flag yet), tags on clients in the client screens, task screens inside a client's profile, and offices other than Service Bureau (Automation is a Service Bureau tool).
