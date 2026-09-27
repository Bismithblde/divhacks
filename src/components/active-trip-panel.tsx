"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  BusFront,
  Check,
  CheckCircle2,
  Footprints,
  LoaderCircle,
  RefreshCw,
  TrainFront,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  ActiveTrip,
  TripDecision,
  TripDecisionOption,
  TripLeg,
} from "@/lib/trips/types";
import { transitCheckInPrompt } from "@/lib/trips/active";
import {
  playTripVoice,
  stopTripVoice,
} from "@/lib/audio/trip-voice";

const playedCheckIns = new Set<string>();

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
  muted,
  onToggleMute,
  onStop,
}: {
  trip: ActiveTrip;
  muted: boolean;
  onToggleMute: () => void;
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
      <div className="active-trip-controls">
        <button
          type="button"
          className="active-trip-audio"
          onClick={onToggleMute}
          aria-label={muted ? "Unmute trip audio" : "Mute trip audio"}
          aria-pressed={muted}
        >
          {muted ? (
            <VolumeX size={17} aria-hidden="true" />
          ) : (
            <Volume2 size={17} aria-hidden="true" />
          )}
        </button>
        <button type="button" className="active-trip-stop" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}

export function TransitArrivalPrompt({
  leg,
  muted,
  loading,
  error,
  onArrived,
  onMissing,
}: {
  leg: TripLeg;
  muted: boolean;
  loading: boolean;
  error: string;
  onArrived: () => void;
  onMissing: () => void;
}) {
  const prompt = transitCheckInPrompt(leg);

  useEffect(() => {
    if (muted || playedCheckIns.has(leg.id)) return;
    const controller = new AbortController();
    const play = async () => {
      await playTripVoice(
        {
          kind: "transit-check-in",
          mode: leg.mode as "BUS" | "SUBWAY",
          routeName: leg.routeName,
        },
        prompt,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        playedCheckIns.add(leg.id);
      }
    };
    void play();
    return () => {
      controller.abort();
      stopTripVoice();
    };
  }, [leg.id, leg.mode, leg.routeName, muted, prompt]);

  return (
    <section
      className="transit-arrival-prompt"
      role="alertdialog"
      aria-labelledby="transit-arrival-title"
      aria-describedby={error ? "transit-arrival-error" : undefined}
      data-testid="transit-arrival-prompt"
    >
      <div className="transit-arrival-heading">
        <span className="transit-arrival-icon">
          <Volume2 size={18} aria-hidden="true" />
        </span>
        <div>
          <span className="active-trip-kicker">Arrival check</span>
          <h2 id="transit-arrival-title">{prompt}</h2>
        </div>
      </div>
      <div className="transit-arrival-actions">
        <button
          type="button"
          className="button primary"
          onClick={onArrived}
          disabled={loading}
          aria-label="Yes, it is here"
        >
          <Check size={18} aria-hidden="true" />
          Yes
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={onMissing}
          disabled={loading}
          aria-label="No, it is late"
        >
          {loading ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <X size={18} aria-hidden="true" />
          )}
          {loading ? "Checking routes" : "No"}
        </button>
      </div>
      {error && (
        <p id="transit-arrival-error" className="transit-arrival-error" role="alert">
          {error}
        </p>
      )}
    </section>
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
