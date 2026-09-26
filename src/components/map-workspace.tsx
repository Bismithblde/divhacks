"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Construction,
  Footprints,
  Info,
  Layers2,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  AlertTriangle,
  Clock3,
} from "lucide-react";
import type {
  ClosureFeature,
  ClosureResponse,
  ClosureKind,
} from "@/lib/closures/types";
import { inBounds } from "@/lib/closures/normalize";

const ClosureMap = dynamic(
  () => import("./closure-map").then((m) => m.ClosureMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Loading map tools…</div>,
  },
);
const EMPTY: ClosureFeature[] = [];
const count = new Intl.NumberFormat("en-US");
const date = (n: number, includeTime = false) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(n);
const updated = (value: string | null) =>
  value ? date(new Date(value).getTime(), true) : "Unavailable";

export function MapWorkspace() {
  const [data, setData] = useState<ClosureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<"all" | ClosureKind>("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<number[] | null>(null);
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [limit, setLimit] = useState(40);
  const [fitRequest, setFitRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/closures?days=${days}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            "The city’s closure feeds are unavailable. Please try again shortly.",
          );
        if (
          body.type !== "FeatureCollection" ||
          !Array.isArray(body.features) ||
          !body.meta?.sources
        )
          throw new Error("Closure data couldn’t be read. Please retry.");
        setData(body);
        setSelectedId(null);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error
              ? e.message
              : "Couldn’t load closures. Check your connection and retry.",
          );
          setExpanded(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5 * 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [days, refresh]);

  const features = data?.meta.days === days ? data.features : EMPTY;
  const filtered = useMemo(
    () =>
      features.filter(
        (f) =>
          (kind === "all" || f.properties.kind === kind) &&
          (!search ||
            `${f.properties.title} ${f.properties.location} ${f.properties.category} ${f.properties.borough}`
              .toLowerCase()
              .includes(search)),
      ),
    [features, kind, search],
  );
  const visible = useMemo(
    () =>
      filtered.filter((f) => !onlyVisible || !bounds || inBounds(f, bounds)),
    [filtered, onlyVisible, bounds],
  );
  const sorted = useMemo(
    () =>
      [...visible].sort(
        (a, b) =>
          (a.properties.kind === "event" ? 0 : 1) -
            (b.properties.kind === "event" ? 0 : 1) ||
          a.properties.title.localeCompare(b.properties.title),
      ),
    [visible],
  );
  const selected = selectedId
    ? filtered.find((f) => f.properties.id === selectedId) || null
    : null;
  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSourcesOpen(false);
    setExpanded(true);
  }, []);
  const onBounds = useCallback((b: number[]) => setBounds(b), []);
  const eventCount = features.filter(
    (f) => f.properties.kind === "event",
  ).length;
  const constructionCount = features.length - eventCount;
  const resetFilters = () => {
    setQuery("");
    setKind("all");
    setOnlyVisible(false);
    setSelectedId(null);
    setLimit(40);
  };
  const sourceWarning = data?.meta.sources.some(
    (s) => s.status !== "ok" || s.unmapped > 0,
  );

  return (
    <div className="app-shell">
      <a href="#closure-panel" className="skip-link">
        Skip to closure list
      </a>
      <header className="navbar">
        <Link href="/" className="brand" aria-label="DivHacks map home">
          <span className="brand-icon">
            <Navigation size={21} strokeWidth={2.4} />
          </span>
          divhacks
          <span className="brand-divider" />
          <span className="brand-context">New York City</span>
        </Link>
        <nav aria-label="Main navigation">
          <button
            className={!sourcesOpen ? "nav-item active" : "nav-item"}
            aria-current={!sourcesOpen ? "page" : undefined}
            onClick={() => {
              setSourcesOpen(false);
              setSelectedId(null);
            }}
          >
            Explore map
          </button>
          <button
            className={sourcesOpen ? "nav-item active" : "nav-item"}
            aria-expanded={sourcesOpen}
            onClick={() => {
              setSourcesOpen((s) => !s);
              setExpanded(true);
            }}
          >
            Data sources
          </button>
        </nav>
        <div className="walking-label">
          <Footprints size={17} />
          <span>Walking first</span>
        </div>
      </header>
      <main className="workspace">
        <section className="map-region" aria-label="Closure map">
          <ClosureMap
            features={filtered}
            selected={selected}
            onSelect={onSelect}
            onBounds={onBounds}
            fitRequest={fitRequest}
          />
          <div className="map-location">
            <MapPin size={16} />
            <span>New York City</span>
            <span className="location-separator" />
            <span>5 boroughs</span>
          </div>
          {(error || sourceWarning) && (
            <button
              className="map-data-warning"
              onClick={() => {
                setSourcesOpen(true);
                setExpanded(true);
              }}
            >
              <AlertTriangle size={16} /> Closure data may be incomplete{" "}
              <ChevronRight size={15} />
            </button>
          )}
        </section>
        <aside
          id="closure-panel"
          tabIndex={-1}
          className={`closure-panel ${expanded ? "expanded" : ""}`}
          aria-label="Closures and events"
        >
          <button
            className="sheet-handle"
            aria-label={
              expanded ? "Collapse closure panel" : "Expand closure panel"
            }
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span />
            <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
            {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          {sourcesOpen ? (
            <>
              <div className="panel-heading">
                <button
                  className="back-button"
                  onClick={() => setSourcesOpen(false)}
                >
                  <ArrowLeft size={18} /> Back to map
                </button>
                <h1>Data sources</h1>
              </div>
              <div className="panel-scroll sources-content">
                <p>
                  We display the city’s mapped event and construction closure
                  schedules across all five boroughs.
                </p>
                {(data?.meta.sources || []).map((s) => (
                  <div className="source-row" key={s.id}>
                    <div className="row-between">
                      <h2>{s.label}</h2>
                      <span className={`source-state ${s.status}`}>
                        {s.status === "ok"
                          ? "Connected"
                          : s.status === "stale"
                            ? "Cached"
                            : "Unavailable"}
                      </span>
                    </div>
                    <p>
                      {count.format(s.total)} source records ·{" "}
                      {s.unmapped
                        ? `${s.unmapped} could not be mapped`
                        : "All records processed"}
                    </p>
                    <p>City updated: {updated(s.updatedAt)} ET</p>
                    <p>Retrieved: {updated(s.fetchedAt)} ET</p>
                    {s.message && <p className="source-warning">{s.message}</p>}
                    <a href={s.url} target="_blank" rel="noreferrer">
                      View official feed <ArrowUpRight size={15} />
                    </a>
                  </div>
                ))}
                {!data && <p>Source details appear after the feeds load.</p>}
                <div className="info-note">
                  <Info size={19} />
                  <div>
                    <strong>Schedules, not street-level confirmation</strong>
                    <p>
                      Construction may happen during only part of a permit
                      window. A road closure doesn’t necessarily block the
                      sidewalk.
                    </p>
                  </div>
                </div>
                <h2>What isn’t covered?</h2>
                <p>
                  Emergency closures, unannounced protests, and newly placed
                  barricades may be missing. Walking access has not been
                  verified. These markers are not navigation instructions.
                </p>
                <p>
                  Feeds refresh every five minutes while this tab is open. The
                  city’s own update schedule determines freshness.
                </p>
                <a
                  className="text-link"
                  href="https://gis.nyc.gov/streetclosure/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open NYC’s official closure map <ArrowUpRight size={15} />
                </a>
              </div>
            </>
          ) : selected ? (
            <ClosureDetails
              feature={selected}
              onBack={() => setSelectedId(null)}
              onSources={() => setSourcesOpen(true)}
            />
          ) : (
            <>
              <div className="panel-heading">
                <div className="row-between">
                  <h1>Explore closures</h1>
                  <span className="heading-icon">
                    <Footprints size={25} />
                  </span>
                </div>
              </div>
              <p className="mobile-uncertainty">
                Scheduled closures · Walking access unconfirmed
              </p>
              <div className="filters">
                <label className="search-label" htmlFor="closure-search">
                  Find a street or event
                </label>
                <div className="search-box">
                  <Search size={19} />
                  <input
                    id="closure-search"
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(40);
                    }}
                    placeholder="Street, event, or borough"
                    autoComplete="off"
                  />
                  {query && (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
                <div className="time-filter">
                  <CalendarDays size={17} />
                  <label htmlFor="time-window" className="sr-only">
                    Closure time window
                  </label>
                  <select
                    id="time-window"
                    value={days}
                    onChange={(e) => {
                      setDays(Number(e.target.value));
                      setSelectedId(null);
                      setLimit(40);
                    }}
                  >
                    <option value={1}>Next 24 hours</option>
                    <option value={7}>Next 7 days</option>
                    <option value={30}>Next 30 days</option>
                  </select>
                  <ChevronDown size={16} />
                  <span>NYC time</span>
                </div>
                <div className="filter-chips" aria-label="Closure type">
                  {(
                    [
                      ["all", "All", features.length],
                      ["event", "Events", eventCount],
                      ["construction", "Construction", constructionCount],
                    ] as const
                  ).map(([value, label, n]) => (
                    <button
                      key={value}
                      className={`filter-chip ${kind === value ? "selected" : ""}`}
                      aria-pressed={kind === value}
                      onClick={() => {
                        setKind(value);
                        setLimit(40);
                      }}
                    >
                      {kind === value && <Check size={14} />} {label}
                      <span>{loading && !data ? "–" : count.format(n)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="list-toolbar">
                <div className="row-between">
                  <h2>{count.format(visible.length)} closure locations</h2>
                  <button
                    className="icon-button"
                    title="Refresh closures"
                    aria-label="Refresh closures"
                    disabled={loading}
                    onClick={() => setRefresh((r) => r + 1)}
                  >
                    <RefreshCw size={16} className={loading ? "spin" : ""} />
                  </button>
                </div>
                <label className="view-filter">
                  <input
                    type="checkbox"
                    checked={onlyVisible}
                    onChange={(e) => {
                      setOnlyVisible(e.target.checked);
                      setLimit(40);
                    }}
                  />{" "}
                  Only in this map view
                </label>
              </div>
              <div className="panel-scroll closure-results" aria-busy={loading}>
                {error && (
                  <div className="inline-alert error" role="alert">
                    <AlertTriangle size={19} />
                    <div>
                      <strong>
                        {data
                          ? "Couldn’t refresh closures"
                          : "Couldn’t load closures"}
                      </strong>
                      <p>{error}</p>
                      {data && (
                        <p>Previously downloaded data may be out of date.</p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setRefresh((r) => r + 1)}
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                )}
                {sourceWarning && (
                  <div className="inline-alert" role="status">
                    <Info size={18} />
                    <div>
                      <strong>Some source data is unavailable</strong>
                      <p>This map may be incomplete.</p>
                      <button
                        className="text-button"
                        onClick={() => setSourcesOpen(true)}
                      >
                        Review data sources
                      </button>
                    </div>
                  </div>
                )}
                {loading && !features.length ? (
                  <div className="loading-rows" role="status">
                    <span className="sr-only">Loading city closure feeds</span>
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ))}
                  </div>
                ) : sorted.length ? (
                  <ul className="closure-list">
                    {sorted.slice(0, limit).map((f) => (
                      <li key={f.properties.id}>
                        <button
                          className="closure-row"
                          onClick={() => onSelect(f.properties.id)}
                        >
                          <span className={`closure-icon ${f.properties.kind}`}>
                            {f.properties.kind === "event" ? (
                              <Sparkles size={19} />
                            ) : (
                              <Construction size={19} />
                            )}
                          </span>
                          <span className="closure-row-copy">
                            <span className="closure-category">
                              {f.properties.kind === "event"
                                ? f.properties.category
                                : "Construction"}
                              <span> · {f.properties.borough}</span>
                            </span>
                            <strong>{f.properties.title}</strong>
                            <span className="closure-location">
                              {f.properties.location}
                            </span>
                            <span className="closure-date">
                              <Clock3 size={12} />
                              {f.properties.start > (data?.meta.start || 0)
                                ? `From ${date(f.properties.start, f.properties.kind === "event")}`
                                : `Scheduled through ${date(f.properties.end, f.properties.kind === "event")}`}
                            </span>
                          </span>
                          <ChevronRight size={17} className="row-chevron" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !error && (
                    <div className="empty-state">
                      <Search size={27} />
                      <h3>No matching closures</h3>
                      <p>
                        Try another street, a longer time window, or a wider map
                        view. Missing reports don’t mean a street is clear.
                      </p>
                      <button
                        className="button secondary"
                        onClick={resetFilters}
                      >
                        Reset filters
                      </button>
                    </div>
                  )
                )}
                {sorted.length > limit && (
                  <button
                    className="load-more button secondary"
                    onClick={() => setLimit((n) => n + 40)}
                  >
                    Show 40 more <ChevronDown size={16} />
                  </button>
                )}
                {sorted.length > 0 && (
                  <p className="list-end">
                    {count.format(Math.min(limit, sorted.length))} of{" "}
                    {count.format(sorted.length)} listed · All{" "}
                    {count.format(filtered.length)} on the map
                  </p>
                )}
              </div>
              <footer className="panel-footer">
                <Info size={16} />
                <p>
                  Road closures may still allow walking.
                  <br />
                  <button
                    onClick={() => {
                      setSourcesOpen(true);
                      setExpanded(true);
                    }}
                  >
                    Check sources & coverage <ArrowUpRight size={12} />
                  </button>
                </p>
              </footer>
            </>
          )}
          <div className="mobile-map-actions">
            <button onClick={() => setExpanded(!expanded)}>
              <Layers2 size={17} />
              {expanded ? "More map" : "Browse closures"}
              {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              aria-label="Fit all filtered closures on map"
              onClick={() => {
                setFitRequest((n) => n + 1);
                setExpanded(false);
              }}
            >
              <SlidersHorizontal size={17} /> Show all
            </button>
          </div>
        </aside>
      </main>
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Updating closure data"
          : error
            ? "Closure data could not be refreshed"
            : `${visible.length} matching closure locations`}
      </div>
    </div>
  );
}

function ClosureDetails({
  feature,
  onBack,
  onSources,
}: {
  feature: ClosureFeature;
  onBack: () => void;
  onSources: () => void;
}) {
  const p = feature.properties;
  return (
    <>
      <div className="panel-heading detail-heading">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={18} /> All closures
        </button>
        <span className={`detail-type ${p.kind}`}>
          {p.kind === "event" ? (
            <Sparkles size={15} />
          ) : (
            <Construction size={15} />
          )}{" "}
          {p.kind === "event" ? "Event street closure" : "Construction closure"}
        </span>
        <h1>{p.title}</h1>
        <p>{p.location}</p>
      </div>
      <div className="panel-scroll detail-content">
        <dl>
          <div>
            <dt>Type</dt>
            <dd>{p.category}</dd>
          </div>
          <div>
            <dt>Permit status</dt>
            <dd>{p.permitStatus}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{p.borough}</dd>
          </div>
          <div>
            <dt>Scheduled window</dt>
            <dd>
              {date(p.start, true)}
              <br />
              to {date(p.end, true)}
              <span className="detail-timezone">
                Eastern time · Includes setup where supplied
              </span>
            </dd>
          </div>
          <div>
            <dt>Mapped as</dt>
            <dd>
              {feature.geometry.type === "Point"
                ? "Intersection"
                : "Street segment"}
            </dd>
          </div>
        </dl>
        <div className="info-note">
          <Footprints size={20} />
          <div>
            <strong>Walking access unconfirmed</strong>
            <p>
              {p.kind === "event"
                ? "This is a permitted event footprint. Sidewalks and crossings may remain open."
                : "The street may close during only part of this permit window. Sidewalk access is not specified."}
            </p>
          </div>
        </div>
        <a
          className="button primary source-link"
          href={p.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          View official source <ArrowUpRight size={17} />
        </a>
        <button className="text-button" onClick={onSources}>
          How we use this data
        </button>
      </div>
    </>
  );
}
