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
