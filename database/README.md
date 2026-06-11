# Autody Database Direction

Autody should move from `data/demo-db.json` to Postgres before real users sign up.

Recommended path: Supabase Postgres.

Why:
- It is still real Postgres, so we keep full SQL control.
- It includes auth, row-level security, storage, realtime, and API tooling we can grow into.
- The frontend can stay on Render while the database lives in Supabase.
- Market/news data can be saved as snapshots so the website does not depend on every visitor hitting outside APIs directly.

Temporary local seed:
- `data/demo-db.json` holds the practice user, demo wallet, orders, settings, and performance data.
- It is useful for shaping the interface, but it is not safe long-term storage on hosting.

Production tables:
- `profiles` stores public user account details.
- `account_modes` separates live account and demo account state.
- `wallets` stores account cash and reserved balances.
- `holdings` stores AU, crypto, stock, and ETF balances.
- `orders` stores paper and later real order history.
- `watchlists` stores saved symbols.
- `research_preferences` stores saved topics.
- `market_snapshots` caches live price data from outside providers.
- `news_snapshots` caches important news stories.
- `app_sessions` is only for the current custom demo login; Supabase Auth can replace it later.

Setup order:
1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run `database/schema.sql`.
4. Add Supabase connection variables to Render.
5. Replace JSON helpers in `server.js` with Postgres queries.

Current implementation status:
- `server.js` already checks `DATABASE_URL`, `SUPABASE_DB_URL`, or `POSTGRES_URL`.
- If one is present, account APIs try Supabase first.
- If Supabase is not configured or the schema has not been run yet, the app falls back to `data/demo-db.json`.
- Live market/news routes now save snapshots into `market_snapshots` and `news_snapshots` when Supabase is connected.

Render environment variable:

```text
DATABASE_URL=postgresql://...
```

Useful check after deployment:

```text
/api/db/status
```

If it returns `provider: "supabase-postgres"`, the website is connected to Supabase. If it returns `provider: "json"`, Render is still missing the database connection string.
