# Role-based navigation

Three purchase tiers, three experiences. The tier is `tenants.tier` (`ptin`, `ero`, `bureau`; default `bureau`, so existing accounts lose nothing). If the column is missing or unreadable the account is treated as `bureau`.

| Tier | Sees |
| --- | --- |
| ptin | My Workspace (clients, client work, documents), Settings |
| ero | + ERO Dashboard (own EFIN, PTINs) |
| bureau | + My Service Bureau, My Store, Leads, Operations |

- Menu: `lib/nav.ts` (`navFor`). Routes to sections: `lib/tier.ts` (`sectionOf`, `allows`). Each gated area has a `layout.tsx` calling `requireSection` (`lib/tier-server.ts`). Non-bureau tiers are redirected from Home to their own start page. Global search and alerts are filtered by tier.
- Tier gates what an account sees; it is not a security boundary (that stays with admin checks and row-level security).
- To change an account's tier: `update tenants set tier = 'ero' where id = '…'`.

## Leads
Free-form tags (`leads.tags`, up to 12 per lead, 40 characters each, lower case). The list filters by tags (a lead must carry every tag chosen), source and status. Source is small grey text on the card. The lead page shows contact info, tags, status, audit score, "Lead since" and notes; the Journey, Link-firm and History sections are removed (events are still recorded).

## Other fixes
Add PTIN lives on the ERO Dashboard (one button; name, PTIN, renewal date, with the rest under "More options"). Firm onboarding shows validation at the field; relationship labels are shared with the filters. Exceptions on Renewals and the bureau dashboard are grouped one row per item. "1 order" grammar, product status label, breadcrumb group "Settings".
