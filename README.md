# The Joint Ledger

A household finance tracker: upload salary slips and credit card statements and let AI pull
out the numbers, record cash & investment snapshots over time in multiple currencies, and
keep a reference list of assets. Shared between two profiles, protected by real login.

## How it's built

Same pattern as the SII Logistics Schedule tool:

- **Frontend**: a single static `index.html` (no build step, no framework).
- **`/api/data`**: each data type (settings, each person's salary/expenses/recurring/govt
  benefits, the shared cash & investments list, assets) lives in its **own** file in
  **Vercel Blob**. Saving one thing only ever reads and rewrites that one file - it can never
  overwrite unrelated data, even if two saves (e.g. both of you uploading slips around the same
  time) happen close together. An earlier version of this stored everything in one combined
  file to save on Blob operations; that traded away exactly this safety and could silently lose
  data under concurrent saves, so it's been reverted to per-collection files.
- **Sync**: no background timer. The app refreshes when you switch back to the tab or the
  window regains focus, plus a **Refresh** link in the sidebar for on-demand sync. Loading
  everything still happens in one round trip from the browser's perspective (the server reads
  all the files in parallel), so this stays easy on Vercel's free Blob tier — see "Staying
  within the free tier" below.
- **`/api/auth`**: login, session verification, and admin-only user management. Sessions are
  a signed, stateless token (HMAC-SHA256, no external JWT library) stored in `localStorage`
  and sent as a Bearer token on every request. Passwords are hashed with `scrypt` (Node's
  built-in `crypto`) — never stored in plain text.
- **`/api/extract`**: holds your Gemini API key server-side and reads payslip/SOA images
  or PDFs into structured JSON. Requires a valid session; viewers can't trigger it.

## Roles

Three roles, same as the logistics tool:
- **Admin** — full access, plus the Users page to add/edit/remove accounts.
- **Editor** — full access to entries (salary, statements, snapshots, assets), no user management.
- **Viewer** — read-only.

## Staying within the free tier

Vercel Blob's Hobby (free) plan includes, per month: 1 GB storage, 10,000 read ("simple")
operations, 2,000 write ("advanced") operations, and 10 GB data transfer. This app is built
to stay well inside all four:

- **Storage**: your data is a handful of small JSON files (one per data type), realistically a
  few KB to a few hundred KB total even after years of entries. Nowhere near 1 GB.
- **Reads**: a full load/refresh reads ~11 small files in parallel (one per data type) rather
  than 1, and reads only happen when you open the app, switch back to the tab, or hit
  **Refresh** — not on a timer. Realistic household use (a handful of visits a day, times two
  people) lands at roughly a few hundred reads a month, still comfortably under 10,000.
- **Writes**: one write per save/delete action, touching only that one data type's file
  (adding a salary slip, an expense, a snapshot, an asset). Even active use — a few entries a
  day — stays far under 2,000/month.
- **Transfer**: proportional to storage size times read count; at this data size, negligible.

If you ever significantly change the design (e.g. add a continuous background sync, or
store large images per asset instead of small thumbnails), it's worth revisiting this math.

## Deploying

### 1. Push this folder to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Import into Vercel
- vercel.com → **Add New Project** → import the GitHub repo.
- Framework preset: **Other**.
- Deploy — it'll succeed, but won't work yet until the steps below are done.

### 3. Enable Vercel Blob storage
- Project → **Storage** → **Create Database** → **Blob** → connect it to this project.
- This auto-adds `BLOB_READ_WRITE_TOKEN` for you.

### 4. Add environment variables
Project → **Settings** → **Environment Variables**:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no credit card, no cost. Sign in with a Google account and click "Create API key." |
| `AUTH_SECRET` | Any long random string (e.g. run `openssl rand -hex 32` locally). Used to sign login sessions — keep it secret, don't reuse it elsewhere. |
| `SEED_ADMIN_USERNAME` | The username for your first admin account, e.g. `jitesh`. |
| `SEED_ADMIN_PASSWORD` | A real password for that first admin account. |

### 5. Redeploy, then log in and create the second account
- Redeploy so the env vars take effect.
- Sign in with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
- Go to **Users** → **+ Add user** and create your partner's account (Editor role is usually
  right for both of you). Assign them the other **data profile** in that form — each login
  is tied to one of the two profiles (whoever's salary/expenses/assets it owns), so make sure
  your account and your partner's are on different profiles. You can rename the profiles
  themselves (from "Profile A"/"Profile B" to actual names) in Settings. You can remove `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` from the
  env vars after this if you'd rather not leave a password sitting in Vercel's settings —
  it's only read when no users exist yet, so it won't be needed again.

## Notes

- **Exchange rates are manual.** No live FX feed is wired in; update rates in Settings whenever
  you want more accurate combined totals.
- **Extraction quality** depends on the clarity of the uploaded image/PDF. Every extraction goes
  through a review-and-edit step before it saves, specifically so you can correct anything it
  misreads.
- **Costs**: Vercel Blob and Vercel Functions have free tiers that comfortably cover a
  two-person household tool. Extraction runs on Gemini's free tier, so there's no per-document
  cost — just be aware free-tier usage means Google may use those requests to improve their
  models (see their terms). If you'd rather avoid that, a paid Gemini or other provider key
  would need a small code change in `api/extract.js`.
