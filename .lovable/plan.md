## Newsletter Subscription System

The project already has a `subscribers` table and a `subscribe_email` RPC wired to the homepage form. Rather than duplicate it as `newsletter_subscribers`, I'll extend the existing table with the missing fields (`verified`, `unsubscribe_token`) and add a public `/unsubscribe` page. This keeps existing subscribers + admin subscribers module working.

### 1. Database migration
Extend `public.subscribers`:
- Add `verified boolean NOT NULL DEFAULT true`
- Add `unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE`
- Backfill tokens for existing rows
- Add index `idx_subscribers_email` (lower(email)) for fast lookup
- Add index on `unsubscribe_token`

Update `subscribe_email` RPC to return the new row's token so we could email it later (silent no-op on duplicate stays — prevents enumeration).

New SECURITY DEFINER RPC `unsubscribe_by_token(_token uuid)`:
- Sets `is_active = false` where token matches
- Returns boolean (found/not found)
- Granted to `anon` + `authenticated`

### 2. Unsubscribe route
New file `src/routes/unsubscribe.tsx`:
- Reads `?token=<uuid>` from search params (with Zod `validateSearch`)
- On mount, calls `unsubscribe_by_token` RPC
- Renders three states: loading, success ("You've been unsubscribed"), invalid/expired ("This link is invalid")
- Uses the same dark Midnight Indigo theme as the rest of the site
- Adds `noindex` meta + canonical

### 3. Homepage form
The existing `NewsletterStrip` in `src/routes/index.tsx` already:
- Validates email format client-side
- Calls `subscribe_email` RPC
- Shows success/error messages
- Handles duplicates silently (RPC uses `ON CONFLICT DO NOTHING`)

No changes needed here — it already meets the spec. I'll just double-check the success message copy.

### 4. Admin
The existing `admin.subscribers.tsx` list continues to work — new columns are additive. No changes needed.

### Technical notes
- Keeping table name `subscribers` avoids a breaking rename across admin route, RPC, RLS policies, security memory, and existing data.
- `verified` defaults to `true` because we're not adding double opt-in email verification in this pass (no email provider wired for newsletters — that was declined earlier). The column exists so double opt-in can be layered in later.
- Unsubscribe is token-only (no auth) via SECURITY DEFINER RPC — no broad table grants added.
