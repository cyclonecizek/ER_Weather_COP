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
Basemap sources are CARTO/OpenStreetMap and Esri World Imagery. The page
uses Manrope and DM Sans with system-font fallbacks.

Tests cover height and sensor-side selection, missing wind values, EFM threshold
boundaries, CC time windows, invalid settings, and partial collector failures.
Actual basemap rendering and interactions need visual confirmation in a browser;
the implementation environment did not expose the supported browser QA tool.
