"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Car,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Construction,
  Footprints,
  Info,
  Layers2,
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
import { activeAt, inBounds } from "@/lib/closures/normalize";
import {
  newYorkDateTimeInput,
  newYorkDateTimeToIso,
  newYorkHourWindow,
  TIMELINE_HOURS,
} from "@/lib/closures/time";
import type {
  Coordinate,
  RouteMode,
  RouteResponse,
  RouteFeature,
} from "@/lib/routing/types";
import { DEMO_LOCATION } from "@/lib/location";
import { ThemeToggle } from "@/components/theme-toggle";
import type {
  GeocodeResponse,
  GeocodeResult,
} from "@/lib/geocoding/types";

const ClosureMap = dynamic(
  () => import("./closure-map").then((m) => m.ClosureMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Loading map tools…</div>,
  },
);
const EMPTY: ClosureFeature[] = [];
const PRELOAD_DAYS = 7;
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
  const [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<"all" | ClosureKind>("all");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLowerCase());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<number[] | null>(null);
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [limit, setLimit] = useState(40);
  const [fitRequest, setFitRequest] = useState(0);
  const [timelineHour, setTimelineHour] = useState(0);
  const [timelineAnchor, setTimelineAnchor] = useState<number | null>(null);
  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [selectingDestination, setSelectingDestination] = useState(false);
  const [destinationSearch, setDestinationSearch] = useState("");
  const [destinationResults, setDestinationResults] = useState<GeocodeResult[]>(
    [],
  );
  const [destinationSearchLoading, setDestinationSearchLoading] =
    useState(false);
  const [destinationSearchError, setDestinationSearchError] = useState("");
  const [destinationActiveIndex, setDestinationActiveIndex] = useState(-1);
  const [avoidClosureIds, setAvoidClosureIds] = useState<string[]>([]);
  const [route, setRoute] = useState<RouteFeature | null>(null);
  const [routeResponse, setRouteResponse] = useState<RouteResponse | null>(
    null,
  );
  const [usingAlternative, setUsingAlternative] = useState(false);
  const [routeMode, setRouteMode] = useState<RouteMode>("foot-walking");
  const [routeModeMenuOpen, setRouteModeMenuOpen] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const routeModeLabel = routeMode === "driving-car" ? "driving" : "walking";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setTimelineAnchor(now);
      setDepartureTime(newYorkDateTimeInput(0, now));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/closures?days=${PRELOAD_DAYS}`, {
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
  }, [refresh]);

  const loadedFeatures =
    data?.meta.days === PRELOAD_DAYS ? data.features : EMPTY;
  const timelineWindow = useMemo(
    () => newYorkHourWindow(timelineHour, timelineAnchor ?? 0),
    [timelineAnchor, timelineHour],
  );
  const features = useMemo(
    () =>
      loadedFeatures.filter((feature) => activeAt(feature, timelineWindow.start)),
    [loadedFeatures, timelineWindow],
  );
  const timelineOptions = useMemo(
    () =>
      Array.from({ length: TIMELINE_HOURS }, (_, offset) =>
        newYorkHourWindow(offset, timelineAnchor ?? 0),
      ),
    [timelineAnchor],
  );
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
    setAvoidClosureIds([id]);
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
    setAvoidClosureIds([]);
    setLimit(40);
  };
  const changeTimelineHour = (value: number) => {
    setTimelineHour(value);
    setSelectedId(null);
    setAvoidClosureIds([]);
    setLimit(40);
    setDepartureTime(newYorkDateTimeInput(value, timelineAnchor ?? 0));
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
  };
  const changeRouteMode = (mode: RouteMode) => {
    setRouteMode(mode);
    setRouteModeMenuOpen(false);
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
  };
  const onDestination = useCallback((coordinate: Coordinate) => {
    setDestination(coordinate);
    setDestinationLabel("");
    setSelectingDestination(false);
    setDestinationResults([]);
    setDestinationSearchError("");
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
    setExpanded(true);
  }, []);
  const lookupPlaces = async (query: string) => {
    const response = await fetch(
      `/api/geocode?q=${encodeURIComponent(query)}`,
    );
    const body = (await response.json()) as GeocodeResponse;
    if (!response.ok) {
      throw new Error(body.error || "Address search is unavailable right now.");
    }
    return body.results;
  };

  useEffect(() => {
    if (destination) return;

    const query = destinationSearch.trim();
    if (query.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDestinationSearchLoading(true);
      setDestinationSearchError("");
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as GeocodeResponse;
        if (!response.ok) {
          throw new Error(
            body.error || "Address search is unavailable right now.",
          );
        }
        if (controller.signal.aborted) return;
        setDestinationResults(body.results);
        setDestinationActiveIndex(-1);
        if (!body.results.length) {
          setDestinationSearchError("No NYC places matched that search.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setDestinationSearchError(
          error instanceof Error
            ? error.message
            : "Address search is unavailable right now.",
        );
        setDestinationResults([]);
      } finally {
        if (!controller.signal.aborted) setDestinationSearchLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destination, destinationSearch]);

  const chooseDestinationResult = (result: GeocodeResult) => {
    setDestination(result.coordinate);
    setDestinationLabel(result.label);
    setDestinationSearch(result.label);
    setSelectingDestination(false);
    setDestinationResults([]);
    setDestinationSearchError("");
    setDestinationActiveIndex(-1);
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
    setExpanded(true);
  };
  const handleDestinationChange = (value: string) => {
    setDestinationSearch(value);
    setDestination(null);
    setDestinationLabel("");
    setDestinationResults([]);
    setDestinationSearchError("");
    setDestinationActiveIndex(-1);
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
  };
  const handleDestinationKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown" && destinationResults.length > 0) {
      event.preventDefault();
      setDestinationActiveIndex(
        (index) => (index + 1) % destinationResults.length,
      );
    } else if (event.key === "ArrowUp" && destinationResults.length > 0) {
      event.preventDefault();
      setDestinationActiveIndex(
        (index) =>
          (index - 1 + destinationResults.length) % destinationResults.length,
      );
    } else if (
      event.key === "Enter" &&
      destinationActiveIndex >= 0 &&
      destinationResults[destinationActiveIndex]
    ) {
      event.preventDefault();
      chooseDestinationResult(destinationResults[destinationActiveIndex]);
    } else if (event.key === "Escape") {
      setDestinationResults([]);
      setDestinationActiveIndex(-1);
    }
  };
  const handleDestinationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (destination) {
      void requestRoute();
    } else if (
      destinationActiveIndex >= 0 &&
      destinationResults[destinationActiveIndex]
    ) {
      chooseDestinationResult(destinationResults[destinationActiveIndex]);
    } else if (destinationResults.length === 1) {
      chooseDestinationResult(destinationResults[0]);
    }
  };
  const requestRoute = async () => {
    let target = destination;
    if (!target) {
      const query = destinationSearch.trim();
      if (query.length < 2) {
        setRouteError("Search for an NYC address or tap the map.");
        return;
      }
      if (destinationResults.length > 1) {
        setRouteError("Choose one of the matching places.");
        return;
      }
      if (destinationResults.length === 1) {
        target = destinationResults[0].coordinate;
        chooseDestinationResult(destinationResults[0]);
      } else {
        setDestinationSearchLoading(true);
        setDestinationSearchError("");
        setRouteError("");
        try {
          const results = await lookupPlaces(query);
          setDestinationResults(results);
          if (results.length === 1) {
            target = results[0].coordinate;
            chooseDestinationResult(results[0]);
          } else if (!results.length) {
            setDestinationSearchError("No NYC places matched that search.");
            return;
          } else {
            setRouteError("Choose one of the matching places.");
            return;
          }
        } catch (error) {
          setDestinationSearchError(
            error instanceof Error
              ? error.message
              : "Address search is unavailable right now.",
          );
          return;
        } finally {
          setDestinationSearchLoading(false);
        }
      }
    }
    const departure = newYorkDateTimeToIso(departureTime);
    if (!departure) {
      setRouteError("Choose a valid NYC departure time.");
      return;
    }
    setRouteLoading(true);
    setRoute(null);
    setRouteResponse(null);
    setUsingAlternative(false);
    setRouteError("");
    try {
      let origin: Coordinate;
      try {
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 3_000,
              maximumAge: 10_000,
            }),
        );
        origin = [position.coords.longitude, position.coords.latitude];
      } catch {
        origin = [DEMO_LOCATION.longitude, DEMO_LOCATION.latitude];
      }
      const response = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination: target,
          departureTime: departure,
          mode: routeMode,
          avoidClosureIds,
        }),
      });
      const body = (await response.json()) as RouteResponse;
      setRouteResponse(body);
      if (!response.ok || body.status !== "ok" || !body.route) {
        setRouteError(
          body.error ||
            `A verified ${routeModeLabel} route is not available right now.`,
        );
      } else {
        setRoute(body.route);
      setUsingAlternative(false);
      }
    } catch {
      setRouteError(
        `Your location or the ${routeModeLabel} route was unavailable. Check permissions and try again.`,
      );
    } finally {
      setRouteLoading(false);
    }
  };
  const sourceWarning = data?.meta.sources.some(
    (s) => s.status !== "ok" || s.unmapped > 0,
  );
  const displayedDurationSeconds =
    usingAlternative && routeResponse?.alternative
      ? routeResponse.alternative.durationSeconds
      : routeResponse?.durationSeconds;
  const routeLabel = useMemo(
    () =>
      routeResponse?.status === "ok" &&
      displayedDurationSeconds !== undefined
        ? {
            durationSeconds: displayedDurationSeconds,
            modeLabel: routeModeLabel,
          }
        : null,
    [displayedDurationSeconds, routeModeLabel, routeResponse?.status],
  );

  return (
    <div className="app-shell">
      <a href="#closure-panel" className="skip-link">
        Skip to closure list
      </a>
      <header className="navbar">
        <Link href="/" className="brand" aria-label="BlockedNYC map home">
          <Image src="/logo.png" alt="" width={36} height={36} className="brand-icon" priority />
          BlockedNYC
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
          <ThemeToggle />
        </nav>
      </header>
      <main className="workspace">
        <section className="map-region" aria-label="Closure map">
          <ClosureMap
            features={filtered}
            selected={selected}
            route={route}
            routeLabel={routeLabel}
            destination={destination}
            selectingDestination={selectingDestination}
            onSelect={onSelect}
            onDestination={onDestination}
            onBounds={onBounds}
            fitRequest={fitRequest}
          />
          <div
            className={`route-planner map-route-planner ${
              sidebarOpen ? "sidebar-open" : "sidebar-collapsed"
            }`}
          >
            <DestinationSearch
              value={destinationSearch}
              loading={destinationSearchLoading}
              error={destinationSearchError}
              results={destinationResults}
              activeIndex={destinationActiveIndex}
              onChange={handleDestinationChange}
              onKeyDown={handleDestinationKeyDown}
              onSubmit={handleDestinationSubmit}
              onChoose={chooseDestinationResult}
              routeMode={routeMode}
              modeMenuOpen={routeModeMenuOpen}
              onToggleMode={() => {
                changeRouteMode(
                  routeMode === "foot-walking"
                    ? "driving-car"
                    : "foot-walking",
                );
                setRouteModeMenuOpen(true);
              }}
              onModeChange={changeRouteMode}
              canSubmit={Boolean(destination || destinationResults.length)}
              routeLoading={routeLoading}
            />
          </div>
          {!sidebarOpen && (
            <button
              className="sidebar-toggle"
              type="button"
              aria-label="Show closures sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <ChevronRight size={18} />
            </button>
          )}
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
          <div className="map-timeline" aria-label="Disruption timeline">
            <div className="timeline-heading">
              <span className="timeline-title">
                <CalendarDays size={15} /> Live at
              </span>
              <strong>{timelineWindow.label}</strong>
              <span className="timeline-count">
                {count.format(features.length)} active
              </span>
            </div>
            <input
              className="timeline-range"
              data-testid="closure-timeline"
              type="range"
              min={0}
              max={timelineOptions.length - 1}
              step={1}
              value={timelineHour}
              onChange={(event) =>
                changeTimelineHour(Number(event.target.value))
              }
              aria-label="Disruption hour"
              aria-valuetext={timelineWindow.ariaLabel}
            />
            <div className="timeline-ticks" aria-hidden="true">
              <span>{timelineOptions[0].label}</span>
              <span>{timelineOptions[timelineOptions.length - 1].label}</span>
            </div>
          </div>
        </section>
        <aside
          id="closure-panel"
          tabIndex={-1}
          className={`closure-panel ${expanded ? "expanded" : ""} ${
            sidebarOpen ? "" : "sidebar-collapsed"
          }`}
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
          {sidebarOpen && (
            <button
              className="sidebar-close"
              type="button"
              aria-label="Hide closures sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <ChevronLeft size={18} />
            </button>
          )}
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
              <h1 className="sr-only">Current disruptions</h1>
              {destination && (
                <div className="route-planner route-details">
                    <p className="route-destination">
                      To{" "}
                      {destinationLabel || "Selected destination"}
                    </p>
                    <label htmlFor="route-departure">Departure · NYC time</label>
                    <input
                      id="route-departure"
                      type="datetime-local"
                      value={departureTime}
                      onChange={(event) => {
                        setDepartureTime(event.target.value);
                        setRoute(null);
                        setRouteResponse(null);
                        setUsingAlternative(false);
                        setRouteError("");
                      }}
                    />
                    {routeError && (
                      <p className="route-error" role="alert">
                        {routeError}
                      </p>
                    )}
                    {routeResponse?.status === "ok" &&
                      routeResponse.alternative &&
                      !usingAlternative && (
                        <div className="route-alternative">
                          <p>
                            Save{" "}
                            {Math.max(
                              1,
                              Math.round(
                                routeResponse.alternative.timeSavedSeconds / 60,
                              ),
                            )}{" "}
                            min by crossing{" "}
                            {routeResponse.alternative.crossedClosures.length}{" "}
                            mapped disruption
                            {routeResponse.alternative.crossedClosures.length ===
                            1
                              ? ""
                              : "s"}
                            .
                          </p>
                          <button
                            className="button secondary"
                            onClick={() => {
                              setRoute(routeResponse.alternative!.route);
                              setUsingAlternative(true);
                            }}
                          >
                            Use faster route anyway
                          </button>
                        </div>
                      )}
                    {routeResponse?.status === "ok" &&
                      routeResponse.alternative &&
                      usingAlternative && (
                        <button
                          className="text-button route-clear-alternative"
                          onClick={() => {
                            setRoute(routeResponse.route || null);
                            setUsingAlternative(false);
                          }}
                        >
                          Use recommended clear route
                        </button>
                      )}
                    {routeResponse?.warnings.map((warning) => (
                      <p className="route-warning" key={warning.code}>
                        {warning.message}
                      </p>
                    ))}
                    {routeResponse?.avoidedClosures.length ? (
                      <p className="route-avoided">
                        Avoiding {routeResponse.avoidedClosures.length} mapped
                        obstacle
                        {routeResponse.avoidedClosures.length === 1 ? "" : "s"}.
                      </p>
                    ) : null}
                </div>
              )}
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
                  <span>Live at selected hour</span>
                  <span>NYC time · 7-day window</span>
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
                  <h2>Current disruptions</h2>
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
                      <h3>No live disruptions at this hour</h3>
                      <p>
                        Try another street or hour. No mapped disruption does
                        not mean the street is clear.
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
              aria-label="Show all filtered closures on map"
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
              : `${visible.length} active disruption locations`}
      </div>
    </div>
  );
}

function DestinationSearch({
  value,
  loading,
  error,
  results,
  activeIndex,
  onChange,
  onKeyDown,
  onSubmit,
  onChoose,
  routeMode,
  modeMenuOpen,
  onToggleMode,
  onModeChange,
  canSubmit,
  routeLoading,
}: {
  value: string;
  loading: boolean;
  error: string;
  results: GeocodeResult[];
  activeIndex: number;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChoose: (result: GeocodeResult) => void;
  routeMode: RouteMode;
  modeMenuOpen: boolean;
  onToggleMode: () => void;
  onModeChange: (mode: RouteMode) => void;
  canSubmit: boolean;
  routeLoading: boolean;
}) {
  const routeModeVerb = routeMode === "driving-car" ? "drive" : "walk";
  return (
    <>
      <form className="destination-search" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="route-destination-search">
          Where to go?
        </label>
        <div className="destination-search-box">
          <Search size={19} aria-hidden="true" />
          <input
            id="route-destination-search"
            type="search"
            role="combobox"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Where to go?"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls="route-destination-results"
            aria-expanded={results.length > 0}
            aria-activedescendant={
              activeIndex >= 0
                ? `destination-result-${activeIndex}`
                : undefined
            }
          />
          {loading && (
            <span className="destination-search-status" aria-live="polite">
              Searching…
            </span>
          )}
          <button
            className="destination-mode-button"
            type="button"
            aria-label={`Travel mode: ${routeModeVerb}`}
            data-mode={routeMode}
            aria-haspopup="menu"
            aria-expanded={modeMenuOpen}
            onClick={onToggleMode}
          >
            {routeMode === "driving-car" ? (
              <Car size={17} aria-hidden="true" />
            ) : (
              <Footprints size={17} aria-hidden="true" />
            )}
            <span>{routeMode === "driving-car" ? "Drive" : "Walk"}</span>
          </button>
          <button
            className="destination-search-submit"
            type="submit"
            disabled={!canSubmit || routeLoading}
          >
            {routeLoading ? "Finding…" : `Find clearest ${routeModeVerb}`}
          </button>
        </div>
        {modeMenuOpen && (
          <div className="route-mode-menu" role="menu" aria-label="Travel mode">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={routeMode === "foot-walking"}
              className={routeMode === "foot-walking" ? "selected" : ""}
              onClick={() => onModeChange("foot-walking")}
            >
              <Footprints size={16} aria-hidden="true" />
              Walk
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={routeMode === "driving-car"}
              className={routeMode === "driving-car" ? "selected" : ""}
              onClick={() => onModeChange("driving-car")}
            >
              <Car size={16} aria-hidden="true" />
              Drive
            </button>
          </div>
        )}
      </form>
      {error && (
        <p className="route-search-error" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul
          id="route-destination-results"
          className="route-search-results"
          aria-label="Destination suggestions"
        >
          {results.map((result, index) => (
            <li key={result.id}>
              <button
                id={`destination-result-${index}`}
                type="button"
                className={index === activeIndex ? "active" : ""}
                onClick={() => onChoose(result)}
              >
                <Search size={14} aria-hidden="true" />
                <span>{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
