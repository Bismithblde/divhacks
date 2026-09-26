# App context

DivHacks project: a mobile-first, map-based PWA offering an alternative to Google Maps, focused on helping people get around obstacles such as parades, protests, and road closures.

- Use Next.js App Router with TypeScript for the frontend and backend route handlers, and Tailwind CSS for styling.
- Initial scope: NYC, walking first. A vehicle road closure does not automatically mean a sidewalk or pedestrian crossing is blocked.
- Prioritize mobile usability, accessible controls, and PWA support.
- The core planned workflow is finding a destination, seeing disruptions, and choosing a route around them.
- Map/routing providers and disruption data sources are undecided. Do not present mock data as live or imply a route is guaranteed clear.
- Keep API credentials and server-only integrations out of client components. Do not cache location-sensitive or live routing responses for offline use by default.

Run `npm run dev` locally. Validate changes with `npm run lint` and `npm run build`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
