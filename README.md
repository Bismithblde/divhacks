# DivHacks

Mobile-first map PWA focused on navigating around parades, protests, and road closures.

## Development

Requires Node.js 20.9+ and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Next.js serves both the frontend and backend.

```sh
npm run lint
npm run build
npm start
```

## Structure

- `src/app/page.tsx`: responsive starter page.
- `src/app/api/health/route.ts`: backend health endpoint (`GET /api/health`).
- `src/app/api/closures/route.ts`: normalized NYC closure feed.
- `src/app/api/geocode/route.ts`: bounded server-side NYC destination search.
- `src/app/api/routes/route.ts`: server-side obstacle-aware walking routes.
- `src/lib/closures/permitted-events.ts`: supplemental NYC Open Data permitted-event adapter.
- `src/lib/closures/centerline.ts`: server-side street-name and intersection geometry resolver.
- `src/app/manifest.ts`: PWA manifest.
- `src/components/service-worker.tsx`: production-only service worker registration.
- `public/sw.js`, `public/offline.html`: offline fallback; live API and map data are never cached.
- `AGENTS.md`: concise app context for coding agents.
- `PRODUCT.md`: product context and open decisions.

## PWA

Run a production build and open it on localhost or HTTPS. The service worker is disabled during development. Once registered, reload online before testing an offline navigation. Install through a supported browser’s install menu (on iOS, Share → Add to Home Screen). Offline support is an explanatory fallback, not offline maps or navigation.

## Routing and destination search

Obstacle-aware walking routes and NYC destination search use OpenRouteService from
server-only route handlers. Add the provider key to `.env.local`:

```sh
OPENROUTESERVICE_API_KEY=your-server-side-key
```

Never use a `NEXT_PUBLIC_` variable for this key. Without it, the UI remains
honest and reports that routing and search are unavailable. Search results are
bounded to the NYC pilot area, and Columbia University is used as the labeled
demo origin when browser geolocation is unavailable.

## Closure data sources

The mapped ArcGIS street-closure layers remain the primary disruption source.
The server also supplements them with NYC Open Data’s permitted-event feed
(`tvpp-9vvx`). Only records with a non-`N/A` street-closure type are considered.
Because that feed provides text locations rather than geometry, the server
matches street ranges against NYC’s DCM Street Centerline dataset before
including them in `/api/closures`. Unresolved records remain counted as
unmapped and are not presented as route obstacles.

PWA setup follows the [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).
