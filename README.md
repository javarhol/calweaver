CalWeaver — AI-assisted auto-scheduler (Google Tasks -> Google Calendar)

Stack
- Cloudflare Pages + Pages Functions (serverless)
- Cloudflare D1 (SQLite)
- Cron Triggers for daily reshuffle (optional later)
- Google OAuth (Tasks + Calendar)
- WebCrypto AES-GCM for encryption-at-rest (BYOK + tokens)

What it does (MVP)
- Pulls incomplete tasks from Google Tasks.
- Uses user-supplied OpenAI key (BYOK) to estimate duration, chunk sizes, and priority.
- Schedules focused blocks into a “CalWeaver Focus” Google Calendar around real meetings from your calendars.
- “Reshuffle now” button: deletes prior CalWeaver blocks within the horizon and creates a fresh plan.

Prerequisites
- Cloudflare account
- Wrangler CLI: npm i -g wrangler
- Google OAuth 2.0 Client (Web application)
  - Authorized redirect URI: https://YOUR-PAGES-DOMAIN/oauth/google/callback
  - Scopes: openid email profile https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/calendar
- (Optional) Local dev at http://127.0.0.1:8788; add http://127.0.0.1:8788/oauth/google/callback to Google OAuth authorized redirects.

Environment variables (secrets/bindings)
Set via: wrangler secret put NAME (secrets) and wrangler d1 create CalWeaverDB (D1)

- GOOGLE_CLIENT_ID (secret)
- GOOGLE_CLIENT_SECRET (secret)
- MASTER_ENCRYPTION_KEY (secret, 32 random bytes Base64, e.g. openssl rand -base64 32)
- SESSION_SECRET (secret, 32 random bytes Base64)
- OPENAI_API_BASE (optional, default https://api.openai.com/v1)
- DEFAULT_MODEL (optional, default gpt-4o-mini)

Database (D1)
- Create DB: wrangler d1 create CalWeaverDB
- Apply schema: wrangler d1 execute CalWeaverDB --file=./schema.sql

Local development
- wrangler pages dev ./public --compatibility-date=2024-09-17

Deploy
- Push to GitHub
- In Cloudflare Pages: Create new project -> Connect to repo
- Set “Build output directory” to public
- Add D1 binding and secrets in Project Settings -> Functions -> D1 / Environment Variables
- (Cron optional) Add a Cron Trigger if you later want automated reshuffles

Default settings
- Horizon: 7 days
- Working hours: 9:00–17:00
- Block size: 25–90 minutes
- Buffer around meetings: 10 minutes
- Max daily focus: 240 minutes (4h)
- Google Calendar only

Important notes
- In Google OAuth “Testing” mode you can invite up to 100 testers. For public release you’ll need app verification.
- BYOK and refresh tokens are encrypted with AES‑GCM using MASTER_ENCRYPTION_KEY and stored in D1.
- We create/find a dedicated calendar “CalWeaver Focus” on first run.

Next steps
1) npm i -g wrangler
2) wrangler d1 create CalWeaverDB
3) Copy the database_id into wrangler.toml (REPLACE_WITH_D1_ID_AFTER_CREATE)
4) wrangler d1 execute CalWeaverDB --file=./schema.sql
5) wrangler pages dev ./public --compatibility-date=2024-09-17
6) In Cloudflare Pages project settings: set secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MASTER_ENCRYPTION_KEY, SESSION_SECRET; bind the D1 DB.
7) Visit the site, click “Connect Google,” save your OpenAI key, set preferences, and click “Reshuffle now.”
