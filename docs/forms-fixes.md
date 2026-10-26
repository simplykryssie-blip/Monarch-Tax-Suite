# Forms fixes

What changed in the Form Builder, and where.

| # | Change | Where |
|---|--------|-------|
| 1 | Side-by-side fields. Each field has a width (full, two thirds, half, third) on a 6-column grid; fields that fit share a row, and stack on a phone. | `lib/forms/definition.ts` (`FIELD_WIDTHS`), builder width select, `.mf-grid` in `globals.css` |
| 2 | Pre-fill and lock for Short and Long answer. The value shows in the field; a locked value is re-applied on the server whatever the browser sends. | `Field.defaultValue/locked`, `withLocked` / `startingAnswers` in `lib/forms/answers.ts` |
| 3 | Staff-only fields. Removed from what respondents get (`publicDefinition`), ignored if sent, never required. Staff fill them in on the submission. | `Field.internal`, `form_internal_values` table (migration `20261029090000`), `saveInternalValues`, submission page |
| 4 | Forms-to-Leads toggle on the same line as the form name when creating a form. | `app/(admin)/forms/page.tsx` |
| 5 | "Key" is now "Field ID (for automations)" with helper text. | builder field panel |
| 6 | Settings: plain-English respondent/customer and firm-record sections. | `app/(admin)/forms/[id]/settings/page.tsx` |
| 7 | After submission: two clear choices, thank-you message or redirect. | same page |
| 8 | Public links never use a Vercel address: they use the form's firm's web address (Settings → Email sending). With none set, no link is shown and the office is told to add one. A form opened on a `*.vercel.app` address in production redirects to the firm's address. | `lib/brands.ts` (`formPublicUrl`, `isPlatformHost`), `lib/forms/link.ts`, `app/f/[id]/page.tsx` |
| 9 | Custom CSS, cleaned and scoped to the form: imports, scripts, fixed overlays and unsafe values are dropped; `body` means the form page. | `lib/forms/theme.ts` (`sanitizeCss`) |
| 10 | Theme: page, form, header, text and button colors, font, logo and header image (uploads go to public image storage under `forms/<form id>/`). | Settings → Look of the form, `components/forms/themed-page.tsx` |

## Migration

`20261029090000_form_internal_values.sql` adds `form_internal_values` (tenant_id from the session, row-level security,
same-tenant foreign key to the submission). Applied to the test project; apply to production before deploying.
Without it the submission page still opens (staff-only values just read as empty) but saving them fails.

## Notes

- The look is stored in the form's settings JSON (`settings.theme`); no other schema change. Saving the main settings keeps it.
- Existing forms keep their widths: `half` still means half; other values are unchanged.
- Test data only was used; no real client records were touched.
