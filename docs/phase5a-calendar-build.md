# Phase 5a — Calendar (build notes)

Branch `claude/phase5a-calendar`, built on 5.0 (`claude/phase5-0-foundations`, PR #65). Merge 5.0 first.

## What it adds
- **Appointment types** (`/calendar/types`): name, link name, length, buffers before and after, start-time step, minimum notice, how far ahead, up to three reminder times, location, whose calendar (the office or one person).
- **Availability** (`/calendar/availability`): weekly hours (two periods a day) and single-date changes (closed, or different hours). With nothing saved, **Business hours** apply, and federal holidays and the office's closures always block booking unless a date row opens that day.
- **Office calendar** (`/calendar`): Agenda (default, a list by day, reads well at 390px), Day and Week. Book for someone, move, cancel (with an optional email to the client), mark Attended or No-show.
- **Public booking** (`/book/<link name>`): on the office's own web address (the address names the office). Times show in the visitor's time zone; the office's is shown on confirmations. Text-reminder consent is its own unticked checkbox and is stored with the time it was given. Per-visitor and per-office limits and a hidden field turn bots away.
- **Manage link** (`/book/manage/<token>`): from the confirmation email: see the appointment, add it to a calendar (.ics), pick another time, cancel. The link is derived from a keyed hash of the appointment id; only its SHA-256 is stored.
- **Reminders**: the 5-minute tick sends due reminders. Email always; text only with consent, from the office's own Twilio account and credits. Each reminder is claimed before it is sent so two sweeps can't both send it. Outside production only the test recipients are contacted.
- **The person**: every booking runs `matchPerson` (client, lead, customer by email). A new person becomes a lead (source "Booking: <type>", tag `booked`).
- **Events** for the Automation Center: `appointment.booked`, `.rescheduled`, `.cancelled`, `.done`, `.no_show`. They are recorded; emailing the person from a workflow arrives with the 5b step builder (events don't carry a person yet).

## Double-booking
`appointments_no_overlap` is an exclusion constraint per office and staff member over the time **including buffers**, for booked appointments only. Two people picking the same time: one wins, the other is told it was just taken.

## Tables (tenant_id from day one; same-tenant foreign keys)
`appointment_types`, `availability_rules`, `appointments`, `appointment_reminders` — migration `20261109090000_calendar.sql` (enables `btree_gist`). Gate: `supabase/tests/phase5a_isolation.sql` (33 checks).

## Setup notes for the owner
- **`book.monarchtaxsuite.com`**: forward it (GoDaddy forwarding or a Vercel redirect) to `https://app.monarchtaxsuite.com/book/<link name>`; the published link then never changes even if the page moves.
- An office's own booking address is its connected web address (Settings → Email sending → link host).
- Not in 5a: Google Calendar sync (deferred), group/round-robin booking, payments at booking.
