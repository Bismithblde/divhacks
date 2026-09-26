# BlockedNYC

Mobile-first NYC trip planning and disruption mapping. Give it a destination
and an arrival deadline, compare transit, walking, and driving options, or
explore the parades, protests, and roadwork nobody told you about.

## The problem

New York closes hundreds of streets every week. Every closure is permitted in advance. Every permit is public record.

Nobody tells the people it affects: drivers, local residents, taxi and rideshare drivers, delivery and gig workers, cyclists.

And the closure isn't the real cost. A parade runs thirty or forty blocks. When you hit it, so did everyone else, and every one of those people is hunting the same detour at the same moment. Two minutes becomes forty.

The data exists. It's scattered across four agencies, published as text rather than geometry, and never assembled into anything a person can use.

## What it does

- See what's closed — live disruption layers on a mobile-first map
- Get around it — walking routes that treat closures as real barriers
- Search a destination — bounded NYC search, relevant to the pilot area
- Works offline — installable PWA with an honest offline fallback

## Quick start

Requires Node.js 20.9+ and npm.

    npm ci
    npm run dev

Open http://localhost:3000. Next.js serves both frontend and backend.

    npm run lint
    npm run build
    npm start

## Routing and search key

Routing and destination search call OpenRouteService from server-only route
handlers. Add the key to `.env.local`:

```sh
OPENROUTESERVICE_API_KEY=your-server-side-key
```

Never use a `NEXT_PUBLIC_` variable for this key. Without it, the UI reports
that routing and search are unavailable rather than failing silently.

## Structure

- `src/app/page.tsx`: Trip Autopilot entry point.
- `src/app/api/health/route.ts`: backend health endpoint (`GET /api/health`).
- `src/app/api/closures/route.ts`: normalized NYC closure feed.
- `src/app/api/geocode/route.ts`: bounded server-side NYC destination search.
- `src/app/api/routes/route.ts`: server-side obstacle-aware walking and driving routes.
- `src/app/api/trips/plan/route.ts`: deadline-aware trip planning endpoint.
- `src/app/api/trips/replan/route.ts`: current-trip stay-versus-switch endpoint.
- `src/components/trip-workspace.tsx`: primary mobile trip workflow.
- `src/lib/trips/`: trip contracts, scoring, LangGraph orchestration, and explanations.
- `src/lib/transit/otp.ts`: OpenTripPlanner and official MTA Bus Time adapters.
- `infra/otp/README.md`: local OTP and MTA feed setup.
- `src/lib/closures/permitted-events.ts`: supplemental NYC Open Data permitted-event adapter.
- `src/lib/closures/centerline.ts`: server-side street-name and intersection geometry resolver.
- `src/app/manifest.ts`: PWA manifest.
- `src/components/service-worker.tsx`: production-only service worker registration.
- `public/sw.js`, `public/offline.html`: offline fallback; live API and map data are never cached.
- `AGENTS.md`: concise app context for coding agents.
- `PRODUCT.md`: product context and open decisions.

Columbia University is the labeled demo origin when browser geolocation is unavailable.

## How it works

Mapped ArcGIS layers are the primary disruption source. The server supplements them with NYC Open Data's permitted-event feed (`tvpp-9vvx`), keeping only records with a non-`N/A` street-closure type.

That feed gives locations as text, never coordinates:

    5 AVENUE between EAST 42 STREET and EAST 59 STREET

## Transit and trip planning

OpenTripPlanner is the transit router. Set `OTP_BASE_URL` to an internal OTP 2
service built with NYC GTFS and MTA subway GTFS-Realtime feeds. The app keeps
the provider behind a typed adapter and returns an explicit unavailable state
when OTP is not configured.

When approved, add the official Bus Time key to the server environment:

```sh
OTP_BASE_URL=http://localhost:8080
MTA_BUS_TIME_API_KEY=your-server-side-key
```

Bus Time is used for live bus stop predictions and vehicle status. The key is
never sent to client components or committed. Without it, bus plans remain
clearly labeled as schedule-based. See `infra/otp/README.md` for the data flow.

Trip planning uses LangGraph as a bounded server-side workflow. Route
selection, closure verification, delay comparison, and stay-versus-switch
decisions are deterministic. An optional model API only explains verified facts
and falls back to a template when unavailable.

## Closure data sources

Turning that into geometry means folding inconsistent street names to one canonical form, finding where each cross street actually meets the main street, and selecting the blocks between them. This happens in `src/lib/closures/centerline.ts`, matched against NYC's DCM Street Centerline dataset.

Records that can't be matched to real geometry are counted as unmapped and are never fed to the router as obstacles. A closure we can't place is worse than no closure at all if it silently reroutes someone.

## Project structure

- `src/app/page.tsx` — responsive map page
- `src/app/api/closures/route.ts` — normalized NYC closure feed
- `src/app/api/routes/route.ts` — obstacle-aware walking routes
- `src/app/api/geocode/route.ts` — bounded NYC destination search
- `src/app/api/health/route.ts` — health endpoint
- `src/lib/closures/centerline.ts` — street-name and intersection resolver
- `src/lib/closures/permitted-events.ts` — NYC Open Data adapter
- `src/app/manifest.ts` — PWA manifest
- `src/components/service-worker.tsx` — production-only service worker registration
- `public/sw.js`, `public/offline.html` — offline fallback
- `tests/` — Playwright end-to-end tests

Further context lives in PRODUCT.md, DESIGN.md and AGENTS.md.

## PWA notes

Run a production build and open it on localhost or HTTPS — the service worker is disabled in development. After it registers, reload once while online before testing an offline navigation.

Install through the browser's install menu. On iOS, Share then Add to Home Screen.

Live API responses and map tiles are never cached. Offline support is an explanatory fallback, not offline maps or navigation. Follows the Next.js PWA guide.

## Honest limits

Scheduled, not live. These are permits and mapped layers. A water main break an hour ago isn't here.

A permit is not a closure. Most DOT permits are minor sidewalk work, which is why only records with a real street-closure type are admitted.

Walking routes only. Driving routes need turn restrictions and one-way handling we haven't built.

NYC pilot area. Search and routing are bounded deliberately rather than returning confident results we can't verify.

## Tech

Next.js (App Router), TypeScript, Tailwind, Playwright, ESLint, OpenRouteService, NYC Open Data, ArcGIS.

## Data sources

- NYC Permitted Event Information — `tvpp-9vvx`
- NYC DCM Street Centerline
- Mapped ArcGIS street-closure layers
- OpenRouteService — routing and geocoding

## Team

Built at DivHacks 2026, Columbia University.
