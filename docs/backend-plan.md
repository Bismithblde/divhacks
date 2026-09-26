# Backend and mapping proposal

Research date: September 26, 2026. Based on AGENTS.md and PRODUCT.md. This is a proposal, not a committed provider selection. Confirmed scope: NYC, walking first. Provider selections remain proposals.

## Recommended hackathon stack

- Next.js client component: MapLibre GL JS with OpenFreeMap vector tiles.
- Next.js route handlers: validated public API and server-side routing adapter.
- openrouteservice hosted Directions API: `foot-walking` profile with request-specific avoid polygons.
- Server-side feed adapters: NYC permitted events are implemented as a
  supplemental source; 511NY and reviewed DOT advisories remain future
  supplements.
- Durable database: start with SQLite on a single persistent Node server for a local/demo deployment; choose a managed relational database before deploying on stateless/serverless infrastructure. Do not use the serverless filesystem as persistent storage.
- Admin-reviewed closure geometry and explicitly labeled demo fixtures as a fallback when live sources are unavailable.

The renderer, basemap, address search, routing engine, and disruption feed are separate services. A free renderer alone does not provide the others. Hosted free routing has quotas; self-hosted open-source routing still consumes compute and storage.

## Map options

| Option | Capabilities | Tradeoff |
| --- | --- | --- |
| MapLibre GL JS + OpenFreeMap | Style vector streets/labels; GeoJSON points, lines, polygons; route overlays; mobile touch interactions | Recommended. WebGL required; public tiles supplied as-is |
| Leaflet + permitted tile provider | Simple markers, polylines, polygons, touch-friendly 2D map | Easy prototype; raster basemap labels/roads cannot be restyled individually |
| OpenLayers + permitted tile provider | Vector/raster layers and editing interactions | Useful for GIS-heavy editing; more API surface than this MVP needs |

Use independent GeoJSON sources for routes, disruptions, and event areas. GeoJSON coordinates use longitude then latitude. Return geometry from the backend; map styling belongs in the client. A route overlay is just a line until a routing engine calculates a navigable path. User-drawn lines need a separate draw/edit interaction and server validation.

Retain map/data attribution. Load only the visible map area and debounce viewport requests. PWA installability does not imply offline maps: keep the existing offline fallback and do not service-worker-cache live routes as current.

Sources: [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [line overlay](https://maplibre.org/maplibre-gl-js/docs/examples/geojson-line/), [OpenFreeMap](https://openfreemap.org/), [OpenFreeMap terms](https://openfreemap.org/tos/), [Leaflet](https://leafletjs.com/), [OpenLayers](https://openlayers.org/).

## Routing options

1. **Hosted openrouteservice, recommended for MVP.** Directions accepts GeoJSON Polygon/MultiPolygon in `options.avoid_polygons`. Published Standard allowance is 2,000 directions/day and 40/minute; confirm the granted account quota at signup. One journey may consume multiple calls. Documented avoidance limits include 150 km route distance, 200 square km polygon area, and 20 km polygon extent. API key stays server-side.
2. **Self-hosted openrouteservice or Valhalla.** No hosted API quota, but setup, OSM graph preparation, updates, storage, and machine resources become our responsibility. Valhalla also supports polygon exclusions. A separate long-running service is more appropriate than executing the routing engine inside a Next.js request.
3. **Curated small-area graph with A*.** No external routing calls; can remove exact edges and run locally. Only appropriate for a tightly bounded demo. Road access, one-way restrictions, sidewalks, crossings, and map freshness become our implementation burden. Do not present this as general navigation.

Destination search is separate: begin with map taps/current location, then add a server-side geocoder adapter. The public Nominatim service has a one-request-per-second limit and prohibits client-side autocomplete; it is not a free search-as-you-type backend.

Sources: [ORS routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options), [ORS plans](https://account.heigit.org/info/plans), [published quota explanation](https://ask.openrouteservice.org/t/pricing-plan-from-the-api/5806), [ORS limits](https://openrouteservice.org/restrictions/), [Valhalla API](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/openapi.yaml), [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

## Disruption data options

### NYC permitted events — implemented supplement

Dataset `tvpp-9vvx` contains approved events in the next month. The current
adapter filters out records with closure type `N/A`, parses the NYC-local
schedule, and resolves street-range text against the DCM Street Centerline
dataset. Unresolved records are reported as unmapped rather than becoming
approximate route obstacles. Sidewalk-only permits are vehicle-clear, while
full street closures are vehicle obstacles; pedestrian access remains
conservative and source-qualified.

Fetch with pagination and time filters. Preserve source records, interpret local dates with the source timezone, and turn street-between-cross-streets descriptions into matched street segments. Unresolved locations remain approximate map notices, not automatic routing exclusions.

Sources: [dataset](https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information/tvpp-9vvx), [metadata](https://data.cityofnewyork.us/api/views/tvpp-9vvx.json), [API](https://data.cityofnewyork.us/resource/tvpp-9vvx.json).

### 511NY events

Structured incidents, roadwork, and closures. Documentation includes direction, timestamps, lane effects, full-closure flag, coordinates, optional encoded polyline, and recurrence schedules. Requires a developer key; documented throttle is 10 calls per 60 seconds. Confirm access and applicable redistribution terms when obtaining the key. We inspected documentation, not an authenticated feed.

Proposed initial polling: every 2–5 minutes, once centrally rather than per user. Actual freshness is bounded by upstream updates. Check each record's geometry; do not assume every event includes a complete road segment or covers pedestrian access.

Sources: [developer access](https://www.511ny.org/developers/help), [event schema](https://511ny.org/help/endpoint/event).

### NYC DOT advisories

Official weekly/weekend/special notices provide street-level descriptions of planned construction, parades, and other events. Their warning explicitly excludes some emergency and long-term closure coverage. Use as reviewed supplements and validation, especially for major parade formation/route/dispersal areas. Parsing HTML requires change detection and ambiguity handling. Do not treat a construction embargo as a road closure.

Source: [DOT advisory](https://www.nyc.gov/html/dot/html/motorist/weektraf.shtml).

### User or organizer reports

Useful for new barricades and spontaneous disruptions that planned feeds cannot establish. Build reports with observation time, point/line/area, affected travel mode, description, and expiry; initially require moderator review. Rate-limit submissions and retain corroboration evidence. Unverified reports remain advisory. Track obstruction geometry rather than individual participants.

No source reviewed establishes complete live protest or pedestrian-closure coverage. Treat that as a known coverage gap. Social/news material may suggest a report for review, but should not automatically block streets.

## Walking-first policy

For the confirmed NYC walking scope, 511NY is supplemental: a full roadway closure does not establish a closed sidewalk or pedestrian crossing. Event footprints can support warnings or a user-selected avoid-events preference, but become automatic hard exclusions only with pedestrian-specific evidence. Preserve pedestrian access through otherwise closed streets when supported. Do not claim wheelchair accessibility from a walking profile.

## Backend flow

Scheduled adapters -> raw source records -> validation/deduplication -> geometry resolution/review -> normalized disruptions -> viewport and route APIs.

Proposed stored entities:

- Source observations: source/external ID, source URL, raw payload, upstream update time, fetch time, ingestion run.
- Disruptions: kind, status (scheduled/active/resolved/unknown), start/end and recurrence, affected modes, full/partial/unknown impact, geometry, geometry precision, evidence status, source links, last verification, expiry/review time.
- Reports/reviews: submitted evidence, moderation state, decision history.
- Ingestion runs: last success, errors, record counts, source freshness.

Keep source reliability, spatial precision, and temporal freshness separate. A precise official planned route can still have unknown current status. Preserve multiple supporting sources when deduplicating; do not merge distinct closures merely because they share a street.

Proposed API:

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/disruptions?bbox=...&mode=...&at=...` | Bounded GeoJSON collection plus source freshness/coverage |
| `POST /api/routes` | Origin/destination, mode, departure time; return route geometry, duration estimate, avoided disruption IDs, warnings, data version |
| `GET /api/geocode?q=...` | Optional destination search; validate/rate-limit requests and protect keys |
| `POST /api/reports` | Validated report submission, moderation queue, abuse limits |
| `POST /api/admin/disruptions/:id/review` | Authenticated confirm/correct/resolve operation |
| Scheduled ingestion command/job | Protected source synchronization outside user-facing requests |

Validate coordinates, bbox area, request sizes, dates, travel modes, and geometry complexity. Bound provider calls and use retry/backoff. Keep secrets server-only. Route inputs need not be retained as personal location history. Key any short-lived routing cache by disruption version, travel mode, and relevant time interval; never serve stale routes as live after an upstream failure.

## Obstacle-aware route calculation

1. Validate origin/destination and mode; limit to supported geography.
2. Select disruptions relevant to the journey time, mode, and supported region. Consider the journey interval, not just departure, where schedules change during travel.
3. Separate confirmed mode-specific blocks from partial, approximate, or uncertain reports. An event or vehicle restriction does not automatically block pedestrians.
4. Convert verified street segments to narrowly buffered polygons in meters, or use authoritative area geometry. Preserve direction where possible; polygon avoidance can overblock opposite lanes, sidewalks, bridges, and tunnels. Exclude such ambiguous cases from automatic hard blocking until reviewed.
5. Ask the router to avoid those polygons. Bound polygon size and vertex count to provider limits. Never silently discard closures to fit a quota.
6. Validate returned geometry against all relevant known blocks, including those outside an initial search corridor. Expand and retry a bounded number of times if needed.
7. Return a route with provenance and warnings, or an explicit no-route/provider-unavailable result. Never fall back silently to a blocked route.

Hard avoidance is feasible with ORS polygons. A softer preference to avoid crowds requires separate candidate scoring or a more customizable router; it is not the same as blocking every reported event.

## Delivery and verification

1. Start with NYC walking in a bounded pilot area; get a routing key. Add a 511NY key for supplementary traffic context.
2. Ship map layers and a curated, explicitly labeled fixture demonstrating a detour.
3. Add durable storage and permitted-event ingestion; review geometry matches and pedestrian impacts on a small area. Prefer verified sidewalk/crossing restrictions and distinguish crowd advisories from impassability.
4. Add routing avoidance and live 511NY adapter; expose source freshness.
5. Add reporting/moderation after the official-feed path is reliable.

Acceptance checks: known closure causes a valid detour; closure expiration restores the original option; vehicle-only closure does not automatically exclude walking; overnight and recurrent schedules resolve correctly; duplicates are linked; failed ingestion produces stale-data warnings rather than an empty "clear" map; quota/network failure produces an honest error; origins inside exclusions and impossible routes are handled; routing exclusions do not accidentally close grade-separated crossings. Measure feed latency, street-segment matching success, and incorrect exclusions on a manually reviewed sample before claiming accuracy.

## Options to choose

- **Fastest demo:** MapLibre + OpenFreeMap + curated closure GeoJSON + hosted ORS. Smallest build; limited live coverage.
- **Recommended MVP:** Same map/router + the implemented NYC permits and
  centerline resolver, then add 511NY and reviewed DOT supplements with durable
  storage. Free services within quotas; most remaining work is geometry and
  data quality.
- **More control later:** Same frontend + self-hosted regional ORS/Valhalla + ingestion/review pipeline. No routing-provider quota; infrastructure and maintenance costs remain.
