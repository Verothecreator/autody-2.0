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
- `asset_catalog` stores Autody-supported tradeable assets, quote currencies, regions, markets, and crypto deposit networks.
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
- On startup, Render runs `database/schema.sql` automatically so new tables stay in sync with the repo.
- While Render is awake, the server refreshes market snapshots every 5 minutes and news snapshots every 30 minutes by default.

Render environment variable:

```text
DATABASE_URL=postgresql://...
```

Optional chart cache controls:

```text
LIVE_CHART_REFRESH_SYMBOLS=BTC,ETH,SOL,SPY,QQQ,GLD
LIVE_CHART_REFRESH_RANGES=1d,1w,1m
```

Useful check after deployment:

```text
/api/db/status
```

If it returns `provider: "supabase-postgres"`, the website is connected to Supabase. If it returns `provider: "json"`, Render is still missing the database connection string.

Live data endpoints:

```text
/api/live/status
/api/live/refresh
/api/markets/catalog
/api/markets/asset/:symbol
/api/markets/charts/:symbol
/api/markets/snapshots
/api/news/snapshots
```

The homepage still calls `/api/markets/crypto`, `/api/markets/stocks`, `/api/markets/signals`, and `/api/news`. Those routes now save fresh provider data into Supabase and fall back to Supabase snapshots if a live provider is down. The signed-in demo markets page uses `/api/markets/catalog` for the broader tradeable asset universe: a CoinGecko-ranked crypto catalog up to 200 assets, AU as an Autody-owned pending-market crypto asset, and 100 global stock, ETF, oil, metals, and commodity-linked instruments. The asset detail page calls `/api/markets/asset/:symbol` for a single instrument, chart points, all-time high/low, FDV/liquidity where available, and the practice account's current demo holding/activity for that asset. The chart-only API `/api/markets/charts/:symbol?range=1d` stores each symbol/range response in `market_chart_snapshots`, giving `1d`, `1w`, `1m`, `3m`, `1y`, and `all` their own database fallback when a live provider is unavailable.
