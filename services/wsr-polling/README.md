# KPSB WSR → GR2Analyst polling bridge

This standalone web service retrieves complete, unmodified Level II radar files from
`https://codiapi-wsr.rad.spaceforce.mil`. It checks every minute and caches the
previous two hours. It does not change the ER Weather COP dashboard or its hosting.
There is no API key in the supplied WSR guide and none is required by this service.

## Deploy on Render

1. Sign into https://dashboard.render.com/ and select **New → Blueprint**.
2. Connect the `cyclonecizek/ER_Weather_COP` repository, branch `main`.
3. Set **Blueprint Path** to `render-wsr.yaml`.
4. Review the new `er-wsr-polling` web service and its Free instance, then deploy.
5. Open the service's actual `https://…onrender.com/` URL. Wait for cached scans to
   appear. Initial backfill retrieves the newest scan first and then older scans.

If you prefer **New → Web Service**, use the same repository and these settings:

| Setting | Value |
| --- | --- |
| Language | Python 3 |
| Root Directory | `services/wsr-polling` |
| Build Command | `python -m unittest discover -s tests -v` |
| Start Command | `python server.py` |
| Health Check Path | `/healthz` |
| Instance Type | Free for initial testing |

Render's free services sleep after 15 minutes without incoming traffic. While
asleep, this service cannot poll. An incoming GR request wakes it; the cache may
need rebuilding. Redeploys/restarts also rebuild the temporary cache. For sustained
unattended collection, choose an always-running paid instance yourself. No paid
resources or persistent disk are requested by this Blueprint. Your existing Render
service and this one share account-level allowances; check your dashboard usage.

GitHub is the source repository. This Python process must run on a server; its
polling URL is the Render service URL, not a GitHub Pages URL. No additional
cron-job.org job is needed while this service is running.

## Configure GR2Analyst

1. Open **File → Configure Polling**.
2. Add the deployed service's root URL, including its trailing slash:
   `https://YOUR-ACTUAL-SERVICE.onrender.com/`.
3. Set the polling interval to **60 seconds**, save, select **KPSB**, and start polling.
4. Confirm scan times advance and radar location/products match the file you
   manually tested. Manual opening of the original API file has already been
   confirmed by the user; live polling still needs this GR client check.

The configuration advertises the original radar ID **KPSB**. It does not relabel
Patrick's radar as KMLB or change the radar coordinates. Some GR versions may
require custom radar-site setup if KPSB does not appear in the site selector; a
successful manual file-open alone does not prove the selector knows that site.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | Human-readable feed status and setup instructions |
| `/config.cfg`, `/grlevel2.cfg` | `ListFile: dir.list` and `Site: KPSB` |
| `/KPSB/dir.list` | Oldest-first `<byte size> <filename>` scan listing |
| `/KPSB/KPSB_YYYYMMDD_HHMMSS.bz2` | Original radar file bytes |
| `/status.json` | Polling success, source age, scan count, errors |
| `/healthz` | HTTP 200 when the web process responds, including during backfill |
| `/readyz` | HTTP 200 only with a scan under 20 minutes old and no current errors |

The filenames follow the convention observed in the Iowa State GR polling feed.
The `.bz2` extension refers to the original Level II internal compressed records;
files are not recompressed. File timestamps are taken from the API's `file_date`
(UTC), not `loaded_at`. API filters use encoded `date>` and `date<` parameter keys,
which produce the guide's `date>=…&date<=…` syntax after query parsing.

Downloads use exact timestamps. A file is listed only after its actual byte count
matches API metadata, its Level II header identifies KPSB, and it has been atomically
renamed into the cache. Oldest-first listings, HEAD requests, full downloads,
byte ranges, suffix ranges, and 416 responses are supported. Completed files are
immutable. Mutable indexes/status are not cached. Failed API calls leave retained
last-good scans available, mark the status degraded, and retry at the next poll.

The service serves complete scans, not incremental tilt chunks. It cannot remove
upstream API latency or create more frequent scans. Around 23:56 UTC on October
19, the API's newest scan was about 14 minutes old. Staleness is visible on the
status page, even while HTTP remains healthy.

No authentication is added: anyone who knows the deployed URL can retrieve its
radar feed. The server only exposes listed radar filenames and fixed status/config
routes; it does not expose cache directory contents or arbitrary local files.

## Local run

Requires Python 3.12+, with no external packages:

```sh
python -m unittest discover -s tests -v
python server.py
```

Use `http://localhost:8080/` as the polling URL on the same computer. On Windows,
`py` may replace `python`. Local cache defaults to `/tmp/wsr-polling`; Windows users
should set `CACHE_DIR` to a writable local folder.

Optional environment variables: `PORT` (8080), `POLL_SECONDS` (60; minimum 30),
`HISTORY_MINUTES` (120; minimum 10), `CACHE_DIR`, `WSR_API_BASE`.

## Protocol and hosting references

- WSR API User Guide supplied by the user, October 16, 2026.
- Live reference: https://mesonet-nexrad.agron.iastate.edu/level2/raw/config.cfg
- Live reference: https://mesonet-nexrad.agron.iastate.edu/level2/raw/KMLB/dir.list
- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
