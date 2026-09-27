"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  BusFront,
  Car,
  Clock3,
  Footprints,
  MapPinned,
  RefreshCw,
  TrainFront,
  TriangleAlert,
} from "lucide-react";
import { DEMO_LOCATION } from "@/lib/location";
import type { GeocodeResponse, GeocodeResult } from "@/lib/geocoding/types";
import type {
  ScoredItinerary,
  TripDecision,
  TripMode,
  TripPlanResponse,
} from "@/lib/trips/types";
import { MapWorkspace } from "./map-workspace";
import { ThemeToggle } from "./theme-toggle";

function defaultArrivalInput() {
  const date = new Date(Date.now() + 45 * 60_000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 16);
}

function time(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function legIcon(mode: string) {
  if (mode === "DRIVE") return <Car size={17} aria-hidden="true" />;
  if (mode === "BUS") return <BusFront size={17} aria-hidden="true" />;
  if (mode === "SUBWAY") return <TrainFront size={17} aria-hidden="true" />;
  return <Footprints size={17} aria-hidden="true" />;
}

function modeIcon(mode: TripMode) {
  if (mode === "driving-car") return <Car size={17} aria-hidden="true" />;
  if (mode === "transit-walk") return <BusFront size={17} aria-hidden="true" />;
  return <Footprints size={17} aria-hidden="true" />;
}

function modeLabel(mode: TripMode) {
  if (mode === "driving-car") return "Drive";
  if (mode === "transit-walk") return "Transit";
  return "Walk";
}

export function TripWorkspace() {
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [arrivalBy, setArrivalBy] = useState(defaultArrivalInput);
  const [plan, setPlan] = useState<TripPlanResponse | null>(null);
  const [decision, setDecision] = useState<TripDecision | null>(null);
  const [travelMode, setTravelMode] = useState<TripMode>("transit-walk");
  const [travelModeMenuOpen, setTravelModeMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (destination || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as GeocodeResponse;
        if (!response.ok) throw new Error(body.error || "Search is unavailable.");
        if (!controller.signal.aborted) setResults(body.results);
      } catch (reason) {
        if (!controller.signal.aborted)
          setSearchError(
            reason instanceof Error ? reason.message : "Search is unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [destination, destinationQuery]);

  const chooseDestination = (result: GeocodeResult) => {
    setDestination(result);
    setDestinationQuery(result.label);
    setResults([]);
    setSearchError("");
    setPlan(null);
    setDecision(null);
    setError("");
  };

  const changeTravelMode = (mode: TripMode) => {
    setTravelMode(mode);
    setTravelModeMenuOpen(false);
    setPlan(null);
    setDecision(null);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!destination) {
      setError("Choose a destination from the search results.");
      return;
    }
    const deadline = new Date(arrivalBy);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      setError("Choose an arrival time in the future.");
      return;
    }
    setLoading(true);
    setError("");
    setDecision(null);
    try {
      const response = await fetch("/api/trips/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: [DEMO_LOCATION.longitude, DEMO_LOCATION.latitude],
          destination: destination.coordinate,
          destinationLabel: destination.label,
          timing: { type: "arrive-by", time: deadline.toISOString() },
          mode: travelMode,
          constraints: { maxTransfers: 3 },
        }),
      });
      const body = (await response.json()) as TripPlanResponse;
      setPlan(body);
      if (!response.ok || body.status !== "ok") {
        setError(body.error || "A verified trip plan is unavailable.");
      }
    } catch {
      setError("Trip planning is unavailable. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const recheck = async () => {
    if (!plan?.plan || !destination) return;
    setRechecking(true);
    setError("");
    try {
      const response = await fetch("/api/trips/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: {
            origin: [DEMO_LOCATION.longitude, DEMO_LOCATION.latitude],
            destination: destination.coordinate,
            destinationLabel: destination.label,
            timing: { type: "arrive-by", time: arrivalByToIso(arrivalBy) },
            mode: travelMode,
            constraints: { maxTransfers: 3 },
          },
          currentPosition: [DEMO_LOCATION.longitude, DEMO_LOCATION.latitude],
          currentLegIndex: 0,
          currentPlan: plan.plan,
        }),
      });
      const body = (await response.json()) as TripDecision;
      if (!response.ok) throw new Error("The trip could not be rechecked.");
      setDecision(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The trip could not be rechecked.");
    } finally {
      setRechecking(false);
    }
  };

  if (showMap) {
    return (
      <div className="autopilot-map-view">
        <button className="autopilot-back" onClick={() => setShowMap(false)}>
          <ArrowRight size={16} style={{ transform: "rotate(180deg)" }} /> Back to Trip Autopilot
        </button>
        <MapWorkspace />
      </div>
    );
  }

  return (
    <div className="autopilot-shell">
      <header className="autopilot-header">
        <div className="autopilot-brand">
          <span className="autopilot-mark"><MapPinned size={19} /></span>
          <span>BlockedNYC</span>
          <span className="autopilot-city">New York City</span>
        </div>
        <div className="autopilot-header-actions">
          <ThemeToggle />
          <button className="autopilot-nav-button" onClick={() => setShowMap(true)}>
            Explore disruptions
          </button>
        </div>
      </header>
      <main className="autopilot-main">
        <section className="autopilot-hero" aria-labelledby="autopilot-title">
          <p className="eyebrow">NYC trip autopilot</p>
          <h1 id="autopilot-title">Get there without guessing.</h1>
          <p className="autopilot-lede">
            Tell us where you need to be and when. We compare subway, bus, and walking options,
            then explain what to do if your trip changes.
          </p>
          <form className="autopilot-form" onSubmit={submit}>
            <div className="autopilot-field">
              <label htmlFor="autopilot-destination">Where are you going?</label>
              <div className="autopilot-input-wrap">
                <MapPinned size={18} aria-hidden="true" />
                <input
                  id="autopilot-destination"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls="autopilot-results"
                  value={destinationQuery}
                  onChange={(event) => {
                    setDestinationQuery(event.target.value);
                    setDestination(null);
                    setResults([]);
                    setPlan(null);
                    setDecision(null);
                    setError("");
                  }}
                  placeholder="Address, station, or landmark"
                  autoComplete="off"
                />
                {searching && <span className="autopilot-searching">Searching</span>}
              </div>
              {searchError && <p className="field-error">{searchError}</p>}
              {results.length > 0 && (
                <ul id="autopilot-results" className="autopilot-results">
                  {results.slice(0, 5).map((result) => (
                    <li key={result.id}>
                      <button type="button" onClick={() => chooseDestination(result)}>
                        <MapPinned size={15} aria-hidden="true" />
                        {result.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="autopilot-field">
              <label htmlFor="autopilot-arrival">Arrive by</label>
              <div className="autopilot-input-wrap">
                <Clock3 size={18} aria-hidden="true" />
                <input
                  id="autopilot-arrival"
                  type="datetime-local"
                  value={arrivalBy}
                  onChange={(event) => setArrivalBy(event.target.value)}
                />
              </div>
            </div>
            <div className="autopilot-field">
              <span className="autopilot-field-label">Travel mode</span>
              <div className="autopilot-mode-control">
                <button
                  className="autopilot-mode-button"
                  type="button"
                  data-mode={travelMode}
                  aria-label={`Travel mode: ${modeLabel(travelMode)}`}
                  aria-haspopup="menu"
                  aria-expanded={travelModeMenuOpen}
                  onClick={() => setTravelModeMenuOpen((open) => !open)}
                >
                  {modeIcon(travelMode)}
                  <span>{modeLabel(travelMode)}</span>
                </button>
                {travelModeMenuOpen && (
                  <div className="autopilot-mode-menu" role="menu" aria-label="Travel mode">
                    {(["transit-walk", "foot-walking", "driving-car"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={travelMode === mode}
                        className={travelMode === mode ? "selected" : ""}
                        onClick={() => changeTravelMode(mode)}
                      >
                        {modeIcon(mode)}
                        <span>{modeLabel(mode)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button className="autopilot-submit" type="submit" disabled={loading}>
              {loading ? "Building your trip…" : "Get me there"}
              {!loading && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </form>
          <p className="autopilot-origin">
            Starting from Columbia University for this demo · <button type="button">Change origin</button>
          </p>
        </section>

        {error && (
          <div className="autopilot-alert error" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
          </div>
        )}

        {plan?.status === "ok" && plan.plan && (
          <TripPlanCard plan={plan.plan} explanation={plan.explanation} warnings={plan.warnings} onRecheck={recheck} rechecking={rechecking} />
        )}
        {decision && (
          <DecisionCard decision={decision} />
        )}
        {!plan && !error && (
          <section className="autopilot-empty">
            <div className="autopilot-empty-icon"><Clock3 size={22} /></div>
            <h2>No route homework.</h2>
            <p>We’ll compare staying put, switching lines, and walking around disruptions when you need to move.</p>
          </section>
        )}
      </main>
      <footer className="autopilot-footer">
        <span>Live estimates are not guarantees.</span>
        <button type="button" onClick={() => setShowMap(true)}>View source coverage</button>
      </footer>
    </div>
  );
}

function arrivalByToIso(value: string) {
  return new Date(value).toISOString();
}

function TripPlanCard({
  plan,
  explanation,
  warnings,
  onRecheck,
  rechecking,
}: {
  plan: ScoredItinerary;
  explanation?: TripPlanResponse["explanation"];
  warnings: TripPlanResponse["warnings"];
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const buffer = plan.arrivalBufferSeconds;
  return (
    <section className="trip-result" data-testid="trip-plan" aria-labelledby="trip-plan-title">
      <div className="trip-result-heading">
        <div>
          <p className="eyebrow">Recommended plan</p>
          <h2 id="trip-plan-title">{explanation?.headline || "Your best verified option"}</h2>
        </div>
        <span className={`realtime-badge ${plan.status}`}>
          <span className="status-dot" /> {plan.status === "realtime" ? "Live estimates" : "Schedule estimate"}
        </span>
      </div>
      <div className="trip-summary">
        <div><strong>{time(plan.departureTime)}</strong><span>Leave</span></div>
        <ArrowRight size={18} aria-hidden="true" />
        <div><strong>{time(plan.arrivalTime)}</strong><span>Arrive</span></div>
        <div className={`trip-buffer ${buffer !== null && buffer < 0 ? "late" : ""}`}>
          <strong>{buffer === null ? duration(plan.durationSeconds) : buffer >= 0 ? `${Math.round(buffer / 60)} min` : `${Math.round(Math.abs(buffer) / 60)} min late`}</strong>
          <span>{buffer === null ? "total trip" : buffer >= 0 ? "deadline buffer" : "behind deadline"}</span>
        </div>
      </div>
      {explanation && (
        <div className="trip-explanation">
          <strong>{explanation.reason}</strong>
          {explanation.steps.map((step) => <span key={step}>{step}</span>)}
        </div>
      )}
      <div className="trip-legs">
        {plan.legs.map((leg) => (
          <div className="trip-leg" key={leg.id}>
            <span className={`trip-leg-icon ${leg.mode.toLowerCase()}`}>{legIcon(leg.mode)}</span>
            <div className="trip-leg-copy">
              <strong>{leg.mode === "WALK" ? "Walk" : leg.routeName || leg.mode}</strong>
              <span>{leg.from.name} <ArrowRight size={12} /> {leg.to.name}</span>
            </div>
            <span className="trip-leg-time">{duration(leg.durationSeconds)}</span>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="trip-warnings" role="status">
          <TriangleAlert size={16} />
          <div>{warnings.map((warning) => <span key={warning.code}>{warning.message}</span>)}</div>
        </div>
      )}
      <button className="trip-recheck" type="button" onClick={onRecheck} disabled={rechecking}>
        <RefreshCw size={16} className={rechecking ? "spin" : ""} />
        {rechecking ? "Checking live conditions…" : "Something changed? Recheck my trip"}
      </button>
    </section>
  );
}

function DecisionCard({ decision }: { decision: TripDecision }) {
  const selected = decision.recommendedOption;
  return (
    <section className="decision-card" data-testid="trip-decision" aria-live="polite">
      <div className="decision-label">
        <RefreshCw size={16} /> Trip update
      </div>
      <h2>{decision.explanation?.headline || (decision.action === "switch" ? "Switch route" : "Stay on your route")}</h2>
      <p>{decision.explanation?.reason || "We compared the latest transit options."}</p>
      {selected && (
        <div className="decision-detail">
          <strong>{time(selected.arrivalTime)}</strong>
          <span>new predicted arrival · {selected.transfers} transfer{selected.transfers === 1 ? "" : "s"}</span>
        </div>
      )}
      {decision.warnings.map((warning) => <p className="decision-warning" key={warning.code}>{warning.message}</p>)}
      {decision.explanation?.caveats.map((caveat) => (
        <p className="decision-warning" key={caveat}>{caveat}</p>
      ))}
    </section>
  );
}
