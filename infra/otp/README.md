# OpenTripPlanner for NYC

This service is intentionally separate from Next.js. It owns the transit graph
and consumes static GTFS plus realtime updates; the public app only calls its
typed GraphQL adapter.

## Local shape

1. Download NYC subway static GTFS and the supplemented near-term schedule from
   the [MTA developer resources](https://www.mta.info/developers).
2. Download an OSM extract covering the five boroughs.
3. Build an OpenTripPlanner 2 graph from those files.
4. Copy `router-config.json` into the OTP data directory and configure the MTA
   subway GTFS-Realtime trip-update and alert feeds as OTP realtime updaters.
5. Run OTP on the internal network and set:

```sh
OTP_BASE_URL=http://localhost:8080
```

### Local Podman quickstart

From the repository root, download the five-borough street extract and the
current static MTA feeds:

```sh
mkdir -p infra/otp/data
curl -L https://download.bbbike.org/osm/bbbike/NewYork/NewYork.osm.pbf \
  -o infra/otp/data/nyc.osm.pbf
curl -L https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip \
  -o infra/otp/data/nyct-subway-gtfs.zip
for borough in bronx brooklyn manhattan queens staten_island; do
  curl -L "https://web.mta.info/developers/data/nyct/bus/google_transit_${borough}.zip" \
    -o "infra/otp/data/nyct-${borough}-gtfs.zip"
done
curl -L https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip \
  -o infra/otp/data/mtabc-gtfs.zip
```

Build the graph once, then serve it on port 8080. Docker-compatible Podman is
used here because it is available on Fedora:

```sh
cp infra/otp/router-config.json infra/otp/data/router-config.json
podman run --rm -e JAVA_TOOL_OPTIONS='-Xmx8g' \
  -v "$(pwd)/infra/otp/data:/var/opentripplanner:Z" \
  docker.io/opentripplanner/opentripplanner:latest --build --save

podman run --rm --name otp -p 8080:8080 \
  -e JAVA_TOOL_OPTIONS='-Xmx8g' \
  -e MTA_GTFS_REALTIME_API_KEY="$MTA_GTFS_REALTIME_API_KEY" \
  -v "$(pwd)/infra/otp/data:/var/opentripplanner:Z" \
  docker.io/opentripplanner/opentripplanner:latest --load --serve
```

`router-config.json` is loaded from the OTP data directory. The MTA realtime
API key is optional for a static smoke test, but must be supplied for live
subway updates if the feed requires authentication. OTP substitutes the
environment variable in the configured request header; do not commit a key.

The Next.js route calls:

```text
/otp/routers/default/index/graphql
```

using a bounded `planConnection` query. OTP returns several itinerary
candidates, including walking access/egress. DivHacks verifies those walking
legs against its own closure snapshot before scoring them.

## Bus realtime

The first graph can include static bus GTFS if the feed is available. Once the
official Bus Time key arrives, set it only in the server environment:

```sh
MTA_BUS_TIME_API_KEY=...
```

The adapter calls Bus Time stop monitoring for bus legs returned by OTP. It
enriches the selected itinerary with live prediction timestamps and vehicle
status. If the key or feed is unavailable, the itinerary remains explicitly
schedule-based; it is never presented as live.

Do not scrape Bus Time. Do not expose either key to browser code. Feed
freshness, missing realtime data, and provider errors are returned as warnings.
