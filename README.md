# The Joint Ledger

A household finance tracker: upload salary slips and credit card statements and let AI pull
out the numbers, record cash & investment snapshots over time in multiple currencies, and
keep a reference list of assets. Shared between two profiles, protected by real login.

## How it's built

Same pattern as the SII Logistics Schedule tool:

- **Frontend**: a single static `index.html` (no build step, no framework).
- **`/api/auth`**: login, session verification, and admin-only user management. Sessions are
  a signed, stateless token (HMAC-SHA256, no external JWT library) stored in `localStorage`
  and sent as a Bearer token on every request. Passwords are hashed with `scrypt` (Node's
  built-in `crypto`) — never stored in plain text.
- **`/api/data?col=<name>`**: a generic collection CRUD endpoint — `op: 'save'` upserts one
  item by id, `op: 'delete'` removes one by id. Each collection (`settings`, `salary_a`,
  `salary_b`, `expenses_a`, `expenses_b`, `snapshots_a`, `snapshots_b`, `assets`) is its own
  JSON file in **Vercel Blob**, your shared database. Per-item saves (rather than overwriting
  a whole array) avoid clobbering each other's edits.
- **`/api/extract`**: holds your Anthropic API key server-side and reads payslip/SOA images
  or PDFs into structured JSON. Requires a valid session; viewers can't trigger it.
- The frontend polls `/api/data` every ~15 seconds so both people stay in sync without a
  manual refresh (paused while a form is open, so it won't overwrite in-progress edits).

## Roles

Three roles, same as the logistics tool:
- **Admin** — full access, plus the Users page to add/edit/remove accounts.
- **Editor** — full access to entries (salary, statements, snapshots, assets), no user management.
- **Viewer** — read-only.

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
| `ANTHROPIC_API_KEY` | Your key from [console.anthropic.com](https://console.anthropic.com) (Settings → API Keys). Billed separately from any Claude.ai subscription — pay-as-you-go. |
| `AUTH_SECRET` | Any long random string (e.g. run `openssl rand -hex 32` locally). Used to sign login sessions — keep it secret, don't reuse it elsewhere. |
| `SEED_ADMIN_USERNAME` | The username for your first admin account, e.g. `jitesh`. |
| `SEED_ADMIN_PASSWORD` | A real password for that first admin account. |

### 5. Redeploy, then log in and create the second account
- Redeploy so the env vars take effect.
- Sign in with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
- Go to **Users** → **+ Add user** and create your partner's account (Editor role is usually
  right for both of you). You can remove `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` from the
  env vars after this if you'd rather not leave a password sitting in Vercel's settings —
  it's only read when no users exist yet, so it won't be needed again.

## Notes

- **Exchange rates are manual.** No live FX feed is wired in; update rates in Settings whenever
  you want more accurate combined totals.
- **Extraction quality** depends on the clarity of the uploaded image/PDF. Every extraction goes
  through a review-and-edit step before it saves, specifically so you can correct anything it
  misreads.
- **Costs**: Vercel Blob and Vercel Functions have free tiers that comfortably cover a
  two-person household tool. The only real ongoing cost is Anthropic API usage per extraction
  (typically a fraction of a cent per document).
