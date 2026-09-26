# DivHacks UI design system

Specification for the next UI implementation. The current starter UI has not yet been migrated to these tokens or fonts.

## Direction

A clean, utility-first interface inspired by Uber's clarity: strong typography, white surfaces, dark primary actions, simple rows, and restrained rounded controls. Soft sage and lavender support the interface without dominating it. Keep the map, destination search, and route information visually dominant. Avoid decorative cards, gradients, and unnecessary shadows.

Use Playfair Display only for occasional welcome or marketing headings. The operational app—including page titles, sheets, and route selection—uses Switzer. This keeps the requested serif identity while making everyday navigation direct and easy to scan.

## Typography

- **Playfair Display:** editorial headings and brief welcome messages outside the core navigation flow. Weight 500 or 600. Fallback: Georgia, serif.
- **Switzer:** body copy, navigation, buttons, search, map labels, route details, and numeric data. Weight 400, 500, or 600. Fallback: Arial, sans-serif.
- Self-host properly licensed WOFF2 assets and use `font-display: swap`. Load only the required weights. Font files are not included in this specification.

| Role | Font / weight | Mobile → desktop | Line height |
| --- | --- | --- | --- |
| Display | Playfair Display 500 | 36 → 56 px | 1.1 |
| App page title / H1 | Switzer 600 | 28 → 36 px | 1.2 |
| App section title / H2 | Switzer 600 | 22 → 28 px | 1.25 |
| Panel title / H3 | Switzer 600 | 20 px | 1.3 |
| Body large | Switzer 400 | 18 px | 1.5 |
| Body / input | Switzer 400 | 16 px | 1.5 |
| Button | Switzer 600 | 16 px | 1.25 |
| Label / navigation | Switzer 500 | 14 px | 1.4 |
| Caption / metadata | Switzer 400 | 12 px | 1.5 |

Use rem units in implementation, with a 16 px default root. Reserve 12 px for supplementary details. Inputs stay at least 16 px. Use sentence case, normal tracking for body copy, and -0.02em for large serif headings. Use tabular numerals for route times and distances.

## Colors

| Token | Hex | Use |
| --- | --- | --- |
| `background` | `#FFFFFF` | Clean white page canvas |
| `surface` | `#FFFFFF` | Search, sheets, menus |
| `surface-muted` | `#F3F3F3` | Search backgrounds, subtle sections, disabled surfaces |
| `foreground` | `#181818` | Headings and primary text |
| `muted` | `#626262` | Supporting copy |
| `border` | `#E2E2E2` | Decorative dividers and surface boundaries |
| `control-border` | `#808080` | Input boundaries when needed to identify controls |
| `primary` | `#181818` | Main action fill |
| `on-primary` | `#FFFFFF` | Primary button text and icons |
| `primary-hover` | `#303030` | Primary hover fill |
| `primary-pressed` | `#000000` | Primary pressed fill |
| `secondary` | `#F0F0F0` | Secondary action fill |
| `on-secondary` | `#181818` | Secondary text and icons |
| `secondary-hover` | `#E2E2E2` | Secondary hover fill |
| `sage` | `#DCEBDD` | Selected filters and supporting highlights |
| `on-sage` | `#254D38` | Text and icons on sage |
| `lavender` | `#EAE4F4` | Alternate-route accents and occasional highlights |
| `on-lavender` | `#55436D` | Text and icons on lavender |
| `accent` | `#F6E1D3` | Peach highlights and occasional editorial accents |
| `on-accent` | `#79472C` | Text on peach |
| `link` | `#181818` | Text links; underline within prose |
| `focus` | `#55436D` | Keyboard focus ring |

Most of each screen should be white, neutral gray, and dark text. Pastels are small supporting fills, not text colors on white or full-screen decoration. Use the named foreground pair for colored fills. Keep one dark primary action per task panel. Color should communicate selection or status rather than decorate every component.

### Semantic colors

| State | Background | Text / icon | Example |
| --- | --- | --- | --- |
| Success | `#E1EFE3` | `#285438` | Preferences saved |
| Warning | `#FFF0CD` | `#76520C` | Disruption reported |
| Error / closure | `#F8DEDC` | `#873C38` | Road closure or failed request |
| Information | `#E0ECF7` | `#345976` | Report details or data freshness |

Always combine semantic color with an icon and text. A successful request does not mean a route is clear. Clearly label sample data, uncertain reports, and unavailable routing.

### Map colors

- Selected route: `#326448`, solid line with a light casing.
- Alternate route: `#76628D`, dashed line with a light casing and an explicit label.
- Disruption: error or warning icon inside a light marker with a dark outline.
- Treat map styling as provider-dependent. Check contrast over actual map tiles before shipping. Never use a pastel line alone to convey a route.

## Spacing and layout

Use a 4 px base: **4, 8, 12, 16, 24, 32, 48, 64**.

- Mobile page gutters: 16 px; tablet: 24 px; desktop: 32 px.
- Panel padding: 20 px on mobile, 24 px on desktop.
- Related controls: 8–12 px apart; component groups: 24 px; sections: 32–48 px.
- Text-heavy content: maximum 65 characters per line.
- Map UI: full available viewport with a bottom sheet on mobile; a 360–400 px side panel on larger screens when space permits.
- Account for device safe areas. Keep attribution, map controls, and selected-route information visible when a sheet opens.

## Shape and elevation

| Token | Value | Use |
| --- | --- | --- |
| `radius-sm` | 8 px | Small labels and tooltips |
| `radius-md` | 12 px | Buttons and inputs |
| `radius-lg` | 16 px | Cards and menus |
| `radius-xl` | 24 px | Top corners of mobile bottom sheets |
| `radius-pill` | 999 px | Filter chips and compact status badges |
| `shadow-floating` | `0 8px 28px rgb(36 53 44 / 10%)` | Controls and sheets floating over a map |

Prefer spacing and subtle dividers for ordinary content. Use shadows to separate overlapping layers, not on every section.

## Component rules

- **Primary button:** near-black fill, white label, 48 px minimum height, 20 px horizontal padding, 12 px radius. Use one clear verb phrase, such as “Find routes.”
- **Secondary button:** light gray fill and near-black label; same sizing as primary.
- **Quiet button:** transparent fill, dark text, muted surface on hover. Icon-only controls require accessible names and a minimum 44 × 44 px hit area.
- **Search field:** white surface, visible control border, 52 px minimum height, 12 px radius, persistent label, 16 px input text. Placeholder text supplements the label.
- **Filter chip:** 44 px minimum hit area, pill shape, neutral default. Selected chips use sage plus a checkmark and programmatic selected state.
- **Route option:** prefer a simple white row with a divider, route summary first, and time aligned consistently. Use a 16 px rounded container only when grouping is necessary. Selected options use a near-black outline and a text or icon indicator. Show report freshness and uncertainty beside relevant information.
- **Alert:** semantic fill, icon, clear title, and concise supporting text. Provide retry actions for recoverable failures.
- **Bottom sheet:** white surface, rounded top corners, accessible heading, explicit expand/collapse control. Dragging is optional, never the only interaction.
- **Disabled controls:** muted surface and muted text, no shadow, semantic disabled state. Explain an unavailable action where the reason is not obvious.
- **Loading controls:** preserve width, show a progress indicator and a label such as “Finding routes…”, and prevent duplicate requests.

## Accessibility and motion

Target WCAG AA: at least 4.5:1 for normal text, 3:1 for large text, and 3:1 for essential control boundaries and graphical indicators. Validate final rendered combinations, including overlays and map tiles.

Use a 2 px focus outline in `focus`, offset 3 px; give map controls a light separation ring when needed. Preserve visible keyboard focus, meaningful heading order, accessible form errors, and usability at 200% zoom.

Use 150 ms color transitions and 200 ms sheet transitions with ease-out timing. Honor `prefers-reduced-motion`. Avoid decorative motion on the map and do not animate live location changes in ways that distract from navigation.

## Implementation contract

Expose color roles as CSS variables and Tailwind theme tokens; use semantic names rather than raw hex values in components. Expose the two font families as `font-display` and `font-sans`. Keep this system light-mode only until a separately validated dark palette exists.

This specification does not connect map providers, routing services, or disruption feeds. Do not cache sensitive location or live routing responses for offline use by default.
