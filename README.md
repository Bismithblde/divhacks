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
- `src/app/manifest.ts`: PWA manifest.
- `src/components/service-worker.tsx`: production-only service worker registration.
- `public/sw.js`, `public/offline.html`: offline fallback; live API and map data are never cached.
- `AGENTS.md`: concise app context for coding agents.
- `PRODUCT.md`: product context and open decisions.

## PWA

Run a production build and open it on localhost or HTTPS. The service worker is disabled during development. Once registered, reload online before testing an offline navigation. Install through a supported browser’s install menu (on iOS, Share → Add to Home Screen). Offline support is an explanatory fallback, not offline maps or navigation.

## Still to build

Map rendering, destination search, disruption feeds, and obstacle-aware routing. Providers, database, geographic coverage, travel modes, and deployment target are undecided. No API keys are required for this scaffold. Store future secrets in `.env.local`; expose only intentionally public values through `NEXT_PUBLIC_` variables.

PWA setup follows the [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).
