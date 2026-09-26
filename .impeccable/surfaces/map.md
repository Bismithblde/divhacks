# NYC closure map

Mode: Operate. Scope: essential map workspace, no landing page.
Inherited authority: DESIGN.md. Switzer operational typography, white and neutral surfaces, dark controls, sage selection, lavender event accents.
First viewport: compact navigation above the actual interactive street map, 380px desktop closure sidebar; mobile map above a collapsible bottom sheet. The map remains the largest surface.
Primary task: see and inspect every available official event/construction closure in the selected time window. Source coverage and pedestrian uncertainty remain visible.
Signature interaction: select a list row to frame and highlight its official geometry; select a line on the map to inspect the same record. Filters update both views together without refetching map tiles.
States: initial load, partial feed outage, complete outage, no filter matches, unavailable WebGL/basemap, stale snapshot, location permission failure.
Code-led implementation of the user-specified map layout and current design system; no new visual world.
