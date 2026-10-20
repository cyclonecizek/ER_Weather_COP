# Eastern Range Weather COP

A map-first common operating picture for forecasters and Launch Weather Officers.

## Map controls

- Toggle WINDS towers, electric field mills, MERLIN CG, MERLIN CC density, and
  915 MHz profilers independently.
- Select surface winds (at or below 20 ft), the lowest available wind level,
  54 ft, the lowest wind level at or above 200 ft, or any exact available height.
  Numeric directional towers are combined using preferred sensor-side selection;
  launch-pad identifiers remain separate.
- Click a station for its observation, age, source, and relevant fields. Profiler
  details include a vertical wind table from the latest published profiler product.
- Search stations, fit the station extent, reset the Cape view, choose a dark,
  light, or satellite basemap, and change labels or gust labels.
- Set the lightning trail to 1–60 minutes. CG appears as gold crosses; CC density
  uses outlined dots on approximately 1 km cells with Replay's density bins.
- Customize EFM thresholds and colors, choose accessible preset colors, edit CC
  density bins/colors, and set the wind-barb color. Preferences persist in local
  browser storage. Restore defaults in Display settings, then Apply.

## EFM display

Default magnitude thresholds match EFM_GR2_Placefile: green below 500 V/m,
yellow from 500 to below 1000 V/m, red at or above 1000 V/m. Values retain their
sign in the inspector. Status flags are shown as dashed marker rings and in the
inspector; their meanings are unconfirmed by the API guide. No quality-control
meaning is inferred from X. A zero or green display is not a launch GO decision.
The configured EFM network matches the existing placefiles. API coordinates
outside Cape coverage use the configured CSV-derived coordinates, explicitly
identified in station details.

## Data path

`python scripts/collect_data.py` generates `dist/data/latest.json` from:

- WINDS one-minute API, latest complete network minute.
- LPLWS one-minute API, configured field mills from the latest minute.
- MERLIN C2C/C2G range APIs, trailing 60 minutes, using actual event time.
  The latest event time is retained separately for ingestion context. Empty
  event results alone do not prove feed health or absence of lightning.
- Published ProfilerPlacefiles JSON and placefile profile tables. The profiler
  product currently uses the archive fallback because the direct profiler API
  is stale. Configured station positions and source observation timestamps are
  preserved. The already-published wind table is rounded to feet and knots.

The collector retains the last good data and timestamp for an individual source
on failure, marks that source as failed, and continues collecting other feeds.
Wind/EFM observations older than 15 minutes and profiler observations older than
180 minutes are dimmed and identified. Lightning expires by actual event time,
so a retained failed snapshot does not hold lightning on the map indefinitely.
CC uses end-exclusive minute windows matching LaunchWeatherReplay.
Missing WINDS 999/9999 values are not plotted; calm winds remain valid.

The GitHub updater requests new snapshots every five minutes; scheduling may be
delayed. The webpage checks for a new snapshot every 60 seconds. This is a
polling observation display, not a continuous real-time warning feed. UTC clocks
and source observation times are shown separately from snapshot generation time.

On GitHub Pages the application fetches same-origin data. On the private Site
it fetches the public GitHub snapshot with a bundled snapshot as initial fallback.
No API keys or user credentials are required. Custom display preferences are
stored only in each browser. All application JS/CSS and Leaflet are vendored,
except optional Google Fonts and external basemap tiles (with attribution).

## Development and deployment

```sh
pip install -r requirements.txt
python -m unittest discover -s tests
node --test tests/core.test.mjs
node --check dist/app.mjs
python scripts/collect_data.py
```

The site is buildless: `dist/` contains the complete static application.
GitHub Pages deploys via `.github/workflows/pages.yml`, including automatic
Pages enablement when permitted by repository settings. The data updater
triggers Pages deployment after successful updates. The private Site's manifest
is `.openai/hosting.json`. Static configuration requires no server secrets.

Leaflet 1.9.4 is included under its BSD-2-Clause license in `dist/vendor/LICENSE`.
Basemap sources are OpenStreetMap (without a key), CARTO (when a key is supplied), and Esri World Imagery. The page
uses Manrope and DM Sans with system-font fallbacks.

Tests cover height and sensor-side selection, missing wind values, EFM threshold
boundaries, CC time windows, invalid settings, and partial collector failures.
Actual basemap rendering and interactions need visual confirmation in a browser;
the implementation environment did not expose the supported browser QA tool.

## Station labels, plot size, and MRMS

The WINDS layer has independent temperature (upper-left, °F), dew point
(lower-left, °F), and RH (lower-right, %) toggles. At Surface, thermodynamics
use a sensor at or below 10 ft independently of the wind sensor at or below
20 ft; each variable's actual height is identified in the inspector. Exact
height selections do not silently substitute a different height. A station
with valid requested thermodynamics can display even when its wind is missing.

Display settings include separate 60–220% size controls for wind station plots
and field mill circles. Defaults are larger than the original: 130% and 115%.
Temperature/dew point/RH toggles and sizes persist per browser.

CARTO currently requires a CARTO Basemaps API key, including for its free tier:
https://www.carto.com/basemaps/apikey/index.html
An optional browser key can be entered under Display settings > Basemap access.
It is sent in tile URLs and should be restricted to the intended website hosts.
Without a key, dark and light use standard OpenStreetMap tiles with normal
browser caching; dark mode applies a client-side visual filter. Attribution
remains visible. No unauthenticated CARTO requests are made.

The MRMS layer is NOAA's `MergedReflectivityQCComposite`, not base reflectivity
or a lowest-elevation substitute. Source:
https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/
Product table:
https://www.nssl.noaa.gov/projects/mrms/operational/tables.php

The scheduled collector downloads the latest compressed GRIB2, uses ecCodes
to decode a regional crop (26–31°N, 84–77°W), and renders a transparent PNG
on a Web Mercator sampling grid for correct Leaflet image alignment. The image
is embedded in the JSON snapshot so image and observation time stay together.
The display threshold is 5 dBZ; missing/no-echo codes are transparent. A dBZ
legend and opacity slider are included. The radar is hidden when older than
20 minutes. The snapshot updates on the existing five-minute schedule, not on
every native MRMS two-minute cycle. No MRMS API key is required.

Tests additionally cover thermodynamic-only stations, surface height pairing,
new-settings migration, marker size limits, radar transparency, and projection
sampling orientation. A real October 16, 2026 composite was decoded and visually
inspected as a standalone image. Browser visual QA remains unavailable here.

## One-minute Cloudflare collection

See [Cloudflare setup](CLOUDFLARE_SETUP.md) for the exact Git-connected
deployment steps. `cloudflare-worker/` is a separate Worker project that
polls WINDS, EFMs, CC, and CG every minute and caches the results in an
automatically provisioned SQLite-backed Durable Object. Radar and profilers
continue to use the five-minute GitHub snapshot as their separate baseline.
Set the Worker URL under Display settings > Live data connection. The GitHub
webpage URL stays the same. No Cloudflare account tokens are placed in the repo.

## Configurable tower wind alerts

Open **Wind alerts** in the dashboard header. Add named rules with selected towers,
1-minute sustained mean, 1-minute peak, or 10-minute peak, a threshold in knots,
and a maximum sensor height in feet AGL. Speed comparison is `>=`; height is `<=`.
Create separate peak and sustained rules to monitor either condition. Rules can
be edited, paused, deleted, and acknowledged, and persist in this browser.
Launch pad sides (for example LC39ANE/NW/SE) are grouped under the pad; numeric
tower sides are grouped under their tower number. For each height, the newest
observation is used, preferring the prevailing side when timestamps match.

The alert panel lists every matching sensor with its value, height, and UTC time.
Click a reading to locate it on the map. Alerts evaluate independently of map
layer visibility and the map's selected height. Optional sound is enabled by a
user click each session and plays once per rule episode. Acknowledgement keeps
the alert visible. Fresh readings below threshold rearm the rule; missing,
invalid, source-error, or observations older than five minutes show data gaps
and do not clear an existing episode. Coverage refers to sensors present in the
feed, not a complete inventory of every installed instrument.

Monitoring requires an open dashboard. Browser suspension and collection/Pages
publishing latency can delay evaluation; this is not a background, email, or
push notification service. Run `node --test tests/*.test.mjs` to check alert and
display logic.

## Lightning rings and hold timers

Open **Lightning watches** in the layers sidebar. Name each watch and choose a
WINDS tower / launch site as its starting point, click a center on the map, or
enter latitude and longitude. Longitude is negative in Florida. Set the radius
in nautical miles (up to 100 nm), hold time in whole minutes (1–60), and CG, CC,
or both detection types. Coordinates can be adjusted to the exact site. Add
multiple watches with the same coordinates for concentric rings. Each watch has
its own radius, hold time, and quiet-state ring color. Watches can be edited,
paused, deleted, located on the map, and have their rings hidden independently
of monitoring. Up to 30 rules persist locally in the browser.

Distances use a great-circle calculation and include the radius boundary. Watches
use detection coordinates directly, independently of CC density cells, layer
visibility, and the selected lightning trail. The newest matching event starts
or restarts the hold, based on its event timestamp rather than ingestion time.
Red rings indicate an active hold; amber dashed rings indicate data gaps; gray
dashed rings indicate paused rules. Sidebar cards and the map watch panel show
hold countdowns. Ring tooltips identify the name, radius, type, and hold time.

Optional sound must be enabled each session. It plays on activation and for a
newer event that resets the hold. Acknowledgement silences the current event;
a newer matching detection rearms it. Known events survive missing rows in a
subsequent snapshot while the page remains open. A hold cannot be released until
a successful query covers its end time. Failed, malformed, incomplete-history,
or stale (>5 minutes) feeds show coverage gaps. “No recent detections” describes
available records, not an operational GO decision or guaranteed sensor coverage.
The current collector retains 60 minutes of records, so longer holds are not
supported. These are open-page alerts, not background or email notifications;
browser suspension, data collection, and Pages deployment can delay evaluation.

## Previous-hour replay

Use the bottom playback bar: **Play / Pause**, previous/next minute buttons,
the minute slider, 1/2/4 frames per second, and **Return to live**. The loop spans
61 minute positions (the latest published minute and its preceding 60 minutes),
wraps automatically, and labels the selected UTC time. Live fetching continues
while playing or paused; updated history retains the chosen absolute time until
it falls outside the rolling window. Ring and wind alerts always evaluate the
live snapshot, and the data-status sidebar remains labeled as live.

`scripts/collect_replay.py` runs after the live collector in the existing cron
workflow. Its separate `dist/data/replay/index.json` contains timestamped WINDS
and EFM observations (65-minute retention), lightning history (125 minutes so a
60-minute trail is available even at the oldest replay frame), and observed
profiler snapshots retained as they become available. Sensor history is fetched
incrementally with a five-minute overlap, deduplicated by source record ID, and
keeps original timestamps. Field mill coordinate fallbacks match the live feed.

MRMS replay downloads the timestamped QC composite files listed in NOAA's
archive, caches PNGs under `dist/data/replay/radar/`, and removes frames older
than 65 minutes. Historical radar is rendered at 700 × 560 pixels over the same
regional bounds; browsers preload and reuse the images for playback. Current
radar keeps its existing resolution. The replay index is loaded on first Play;
while used, it refreshes alongside live observations.

Frames select only observations at or before the selected time. Wind and EFM
readings carry forward at most two minutes, radar at most five minutes, and
profiler profiles at most twenty minutes. Missing or failed-source coverage is
listed in the replay bar; future/live radar is never substituted for missing
historical radar. Profiler history begins with snapshots observed by this
collector, so it can have gaps until enough archive updates have been retained.
Map layer, height, colors, gust, and thermodynamic settings continue to apply.

## Barnes convergence / divergence

The map's Barnes layer is enabled by default and can be toggled in Map Layers.
It always analyzes 54-ft one-minute average winds, independently of the map's
selected tower height and gust display. The two-pass Barnes analysis runs from
API observation values in the live snapshot, or the timestamped API history
while replaying. Cached frames keep playback responsive. It uses a 500 m grid,
10 km Barnes length, gamma 0.30, 28 km influence radius, 12 km nearest-tower
limit, at least three nearby stations, and a 12 km hull buffer, matching the
WINDS GR2 Barnes generator. There must be at least five distinct fresh 54-ft
towers; winds more than five minutes old, future records, missing values, and
out-of-region coordinates are excluded. Sensor sides follow prevailing-side
selection, with the newest report taking precedence.

Wind vectors are converted from knots to m/s before spatial analysis. Central
differences yield horizontal divergence in 10^-4 s^-1. Warm colors indicate
negative divergence (convergence), cool colors indicate positive divergence,
and white marks zero. Contours are spaced at 1 unit from −12 through +12 and
use the same light smoothing as GR2. Hover a contour for its value. Areas
without enough station support are masked. This is a derived visualization,
not an official operational analysis. Tests compare the browser's grid values
against a fixture generated by the GR2 Python algorithm, in addition to checking
known linear-flow signs and units.

## Individual MERLIN CC detections

The CC display selector switches between individual detection points (the default)
and the existing approximately 1 km density grid. The choice persists in browser
preferences. Both modes use the same selected lightning trail and replay time
window; invalid coordinates and out-of-window records are excluded. The point
view places each available detection at its reported coordinates without spatial
aggregation or thinning, using Leaflet canvas circles for large event sets.
Click a point for its source timestamp, record ID, and available metadata. These
are MERLIN detection records, not clustered flashes. Density thresholds and
palettes continue to apply to the density-grid view.

### Operations monitor and data dock

The Operations button opens a live ring board and unified alert center. Existing
custom watches and wind rules are retained. **Add 14 site presets** explicitly loads
the boundaries supplied in `hannahdashboard.html`; it does not silently enable new
watches for returning users. Presets use both CG/CC and a 30-minute hold. Review
those settings as needed. The original polygon vertices are preserved for rendering
and detection inclusion. Changing a preset's center or nominal radius in the editor
converts that watch to a circle. The board shows the last detection, hold countdown,
CG/CC counts in the hold window, approximate nearby counts within 5 nm of the
boundary, and five-minute activity bins over the prior hour. Ring cards locate the
watch on the combined map.

The alert center combines active wind/lightning conditions and source-health gaps.
Acknowledging a condition does not hide it or release its latch. Optional sounds and
desktop notifications require session interaction/browser permission and only work
while the page can run. Existing wind metric choices and fresh-data requirements
remain in force. Lightning holds cannot release during a coverage gap. There is no
storm ETA prediction in this update.

**Data & log** opens sortable, searchable WINDS and field-mill observations, a strike
log, and a local event log, with CSV exports. Observation and strike tables follow
the map's live/replay time, independently of layer visibility. All sensor heights
are shown by default; the wind table can instead follow the map height selection.
Clicking a station row locates the sensor and enables its map layer. The tables
retain separate one-minute mean, one-minute peak, and ten-minute peak columns;
temperature/dewpoint/RH belong to the displayed sensor height. Field-mill categories
use the same configurable magnitude thresholds and colors as the map, with API flags
preserved.

Alerts, ring cards, source-health reporting and event history always use live data,
even during replay. The event log records activations, acknowledgements, newer
lightning detections resetting holds, confirmed releases, source gaps/recovery and
monitor pauses. The last seven days/up to 2,000 events are saved in this browser,
with optional operator initials and CSV export. The log does not reconstruct events
while the browser was closed and is not a shared or authoritative shift log.

Validation includes polygon boundary/edge inclusion, existing stale-source and hold
release tests, preferred-side table selection, event transitions, future/duplicate
strike exclusion, and CSV quoting/formula neutralization in
`tests/operations.test.mjs`.
