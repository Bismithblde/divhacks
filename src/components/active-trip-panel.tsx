"use client";

import {
  ArrowRight,
  BusFront,
  CheckCircle2,
  Footprints,
  RefreshCw,
  TrainFront,
  X,
} from "lucide-react";
import type {
  ActiveTrip,
  TripDecision,
  TripDecisionOption,
  TripLeg,
} from "@/lib/trips/types";

function time(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function legIcon(leg: TripLeg) {
  if (leg.mode === "BUS") return <BusFront size={17} aria-hidden="true" />;
  if (leg.mode === "SUBWAY") return <TrainFront size={17} aria-hidden="true" />;
  return <Footprints size={17} aria-hidden="true" />;
}

export function ActiveTripBanner({
  trip,
  onStop,
}: {
  trip: ActiveTrip;
  onStop: () => void;
}) {
  const leg = trip.route.legs[trip.currentLegIndex] || trip.route.legs[0];
  return (
    <div className="active-trip-banner" role="status" data-testid="active-trip">
      <div className="active-trip-icon">{legIcon(leg)}</div>
      <div className="active-trip-copy">
        <span className="active-trip-kicker">
          {trip.status === "waiting" ? "Waiting for departure" : "Trip in progress"}
        </span>
        <strong>
          {leg.mode === "WALK" ? "Walk" : leg.routeName || leg.mode} ·{" "}
          {leg.to.name}
        </strong>
        <small>
          {time(leg.endTime)} expected · {trip.route.arrivalBufferSeconds === null
            ? "schedule estimate"
            : `${Math.max(0, Math.round(trip.route.arrivalBufferSeconds / 60))} min buffer`}
        </small>
      </div>
      <button type="button" className="active-trip-stop" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}

export function TripAdjustmentPrompt({
  decision,
  onChoose,
  onDismiss,
}: {
  decision: TripDecision;
  onChoose: (option: TripDecisionOption) => void;
  onDismiss: () => void;
}) {
  const options = decision.options || [];
  return (
    <section className="trip-adjustment-prompt" role="alert" data-testid="trip-adjustment">
      <div className="trip-adjustment-heading">
        <div>
          <span className="active-trip-kicker">
            <RefreshCw size={13} /> Trip update
          </span>
          <h2>{decision.explanation?.headline || "Your route changed"}</h2>
          <p>{decision.explanation?.reason || "We found another way to get there."}</p>
        </div>
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Keep current route">
          <X size={17} />
        </button>
      </div>
      <div className="trip-adjustment-options">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`trip-adjustment-option ${option.recommended ? "recommended" : ""}`}
            onClick={() => onChoose(option)}
          >
            <span className="trip-adjustment-option-icon">
              {option.action === "keep-current" ? (
                <CheckCircle2 size={16} />
              ) : (
                <ArrowRight size={16} />
              )}
            </span>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
