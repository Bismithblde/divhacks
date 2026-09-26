# BlockedNYC

A mobile-first map that routes you around the parades, protests and roadwork nobody told you about.

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

Routing and destination search call OpenRouteService from server-only route handlers. Add the key to `.env.local`:

    OPENROUTESERVICE_API_KEY=your-server-side-key

Never use a `NEXT_PUBLIC_` variable for this key — that ships it to every browser that loads the page.

Without the key the app still runs and reports plainly that routing and search are unavailable, rather than failing silently. Columbia University is the labeled demo origin when browser geolocation is unavailable.

## How it works

Mapped ArcGIS layers are the primary disruption source. The server supplements them with NYC Open Data's permitted-event feed (`tvpp-9vvx`), keeping only records with a non-`N/A` street-closure type.

That feed gives locations as text, never coordinates:

    5 AVENUE between EAST 42 STREET and EAST 59 STREET

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
