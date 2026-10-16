# One minute collection setup

The webpage stays at https://cyclonecizek.github.io/ER_Weather_COP/.
Cloudflare hosts only the observation API. GitHub continues to host the webpage,
collect MRMS/profiler data, and provide the fallback snapshot.

## Deploy from GitHub

1. Sign in at https://dash.cloudflare.com/ and select your account.
2. Open **Workers & Pages**, select **Create application**, then choose the
   option to import/connect a Git repository for a **Worker** (not Pages).
3. Connect GitHub if prompted. Grant the integration access to
   `cyclonecizek/ER_Weather_COP` and select that repository.
4. Use these exact settings:

   | Setting | Value |
   | --- | --- |
   | Worker/project name | `er-weather-cop-data` |
   | Production branch | `main` |
   | Root directory | `cloudflare-worker` |
   | Build command | `npm test` |
   | Deploy command | `npx wrangler deploy` |

   Leave build output directory unset; this is an API Worker, not a static Pages
   project. Use the automatically created deployment API token unless your
   account's policy requires a custom token. Do not paste tokens into GitHub.
5. Deploy. The checked-in Wrangler configuration creates the
   `OBSERVATIONS` Durable Object binding and the `* * * * *` Cron Trigger.
   Storage is provisioned automatically; there is no database ID or schema to enter.
6. Open the Worker after deployment. Under **Settings > Triggers > Cron Triggers**,
   confirm `* * * * *` (every minute). The schedule is managed in the repository;
   do not add a duplicate trigger in the dashboard.
7. Under **Settings > Build > Build watch paths**, limit included paths to
   `cloudflare-worker/*` (Cloudflare's wildcard matches nested paths). This avoids
   rebuilding the API on each automated observation snapshot commit.
   If your UI shows different labels, look for build watch/include paths.

## Verify collection

Copy the actual workers.dev URL returned by Cloudflare. An example shape is:

`https://er-weather-cop-data.YOUR-SUBDOMAIN.workers.dev`

Open that URL with `/health` appended. The initial response may be
`"status":"warming_up"`. Initial Cron activation can take up to 15 minutes.
After the first completed poll, look for:

- `status`: `ok` (or `degraded` if an individual upstream request failed).
- `last_poll_at`: a recent UTC timestamp.
- `statuses`: `ok` for `winds`, `efm`, `cc`, and `cg`.

Wait roughly a minute and refresh `/health`; `last_poll_at` should advance.
Then open `/api/observations`. It should return `generated_at`, a `collector`
value identifying Cloudflare one-minute polling, and the source `feeds`.
Health reads do not force upstream polls.

## Connect the dashboard

1. Refresh https://cyclonecizek.github.io/ER_Weather_COP/.
2. Open the settings gear.
3. Scroll to **Live data connection**.
4. Paste your Worker root URL into **Cloudflare Worker URL**. The dashboard
   automatically adds `/api/observations` when you paste a root URL.
5. Select **Apply settings**.
6. Confirm the header reports **Minute feed connected** and data status times
   advance when the source APIs publish new observations.

The setting is saved in that browser. Share the actual Worker URL back in the
chat to make it the default for all visitors without changing the webpage URL.
If the Worker cannot be reached, the app labels the failure and uses the GitHub
snapshot fallback. Clearing the Worker URL restores GitHub-only collection.

## What updates when

- WINDS and EFMs: polled every minute; actual observation age is still displayed.
- CC and CG: polled every minute, retaining 60 minutes of detections. Polls use
  actual event times, overlapping lookback windows, exact-ID deduplication, and
  regional bounds (26–31°N, 84–77°W).
- MRMS: remains on the separate five-minute GitHub render path. Native MRMS
  composite production is nominally every two minutes.
- Profilers: remain on the separate published-profile path and nominally report
  every 15 minutes; the archive fallback remains active while the API is stale.

Every-minute scheduling is a target, not a guarantee that a new observation is
available exactly each minute. The Worker retains original observation times,
marks individual feed errors, and reports delayed polling through `/health`.

## Tests and resource behavior

Run from `cloudflare-worker`:

```sh
npm ci
npm test
npx wrangler deploy --dry-run
```

The Worker uses SQLite-backed Durable Objects, available on Workers Free.
Actual consumption depends on traffic and lightning activity; monitor Cloudflare
usage after deployment. Observation JSON is chunked in storage. Regional,
incremental lightning queries avoid repeatedly downloading the entire hour.
The public API only allows reads; only the scheduled handler invokes collection.
Allowed browser origins are the GitHub site origin and the existing private Site.
If you add another website host, update `ALLOWED_ORIGINS` in `wrangler.jsonc`.

Cloudflare references:

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
