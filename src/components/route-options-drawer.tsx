"use client";

import { useState } from "react";
import {
  ArrowRight,
  BusFront,
  Car,
  ChevronDown,
  Footprints,
  MapPin,
  TrainFront,
} from "lucide-react";
import type { RouteOption, RouteStep } from "@/lib/trips/types";

function clock(value: string) {
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

function icon(mode: RouteStep["mode"]) {
  if (mode === "BUS") return <BusFront size={15} aria-hidden="true" />;
  if (mode === "SUBWAY") return <TrainFront size={15} aria-hidden="true" />;
  if (mode === "DRIVE") return <Car size={15} aria-hidden="true" />;
  return <Footprints size={15} aria-hidden="true" />;
}

function optionSummary(option: RouteOption) {
  const transit = option.legs
    .filter((leg) => leg.mode === "BUS" || leg.mode === "SUBWAY")
    .map((leg) => leg.routeName)
    .filter((name): name is string => Boolean(name));
  return transit.length ? transit.join(" → ") : "Direct route";
}

function stepGroups(steps: RouteStep[]) {
  return steps.reduce<Array<{ mode: RouteStep["mode"]; steps: RouteStep[] }>>(
    (groups, step) => {
      const previous = groups[groups.length - 1];
      if (previous?.mode === step.mode) previous.steps.push(step);
      else groups.push({ mode: step.mode, steps: [step] });
      return groups;
    },
    [],
  );
}

export function RouteOptionsDrawer({
  options,
  selectedId,
  destinationLabel,
  onSelect,
  onStart,
}: {
  options: RouteOption[];
  selectedId: string | null;
  destinationLabel: string;
  onSelect: (option: RouteOption) => void;
  onStart?: (option: RouteOption) => void;
}) {
  const selected = options.find((option) => option.id === selectedId) || options[0];
  const [stepsOpen, setStepsOpen] = useState(true);
  const [walkingGroupsOpen, setWalkingGroupsOpen] = useState<
    Record<string, boolean>
  >({});

  if (!selected) return null;

  return (
    <section
      className="route-options-drawer"
      aria-label="Route options"
      data-testid="route-options"
    >
      <div className="route-options-heading">
        <div>
          <p className="route-eyebrow">Routes to</p>
          <h2>{destinationLabel || "your destination"}</h2>
        </div>
        <span className="route-option-count">
          {options.length} option{options.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="route-option-list">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`route-option-card ${
              option.id === selected.id ? "selected" : ""
            }`}
            onClick={() => onSelect(option)}
            aria-pressed={option.id === selected.id}
          >
            <span className="route-option-time">
              <strong>{clock(option.arrivalTime)}</strong>
              <small>arrive</small>
            </span>
            <span className="route-option-main">
              <strong>{optionSummary(option)}</strong>
              <span>
                {duration(option.durationSeconds)} ·{" "}
                {option.transfers} transfer{option.transfers === 1 ? "" : "s"} ·{" "}
                {duration(option.walkingSeconds)} walking
              </span>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="route-selected-summary">
        <div className="route-selected-summary-heading">
          <div>
            <span className="route-eyebrow">Selected route</span>
            <strong>
              Leave {clock(selected.departureTime)} · arrive{" "}
              {clock(selected.arrivalTime)}
            </strong>
          </div>
          <span className={`route-freshness ${selected.status}`}>
            {selected.status === "realtime" ? "Live" : "Scheduled"}
          </span>
        </div>
        <button
          type="button"
          className="route-steps-toggle"
          onClick={() => setStepsOpen((open) => !open)}
          aria-expanded={stepsOpen}
        >
          <span>
            <MapPin size={15} aria-hidden="true" /> Step-by-step directions
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={stepsOpen ? "rotate-180" : ""}
          />
        </button>
        {stepsOpen && (
          <ol className="route-step-list" data-testid="route-steps">
            {stepGroups(selected.steps).map((group, groupIndex) => {
              if (group.mode === "WALK") {
                const groupId = `${selected.id}-walk-${groupIndex}`;
                const isOpen = Boolean(walkingGroupsOpen[groupId]);
                const walkingSeconds = group.steps.reduce(
                  (total, step) => total + step.durationSeconds,
                  0,
                );
                return (
                  <li className="route-walking-group" key={groupId}>
                    <button
                      type="button"
                      className="route-walking-toggle"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setWalkingGroupsOpen((current) => ({
                          ...current,
                          [groupId]: !isOpen,
                        }))
                      }
                    >
                      <span className="route-step-icon">
                        {icon("WALK")}
                      </span>
                      <span className="route-step-copy">
                        <strong>Walk · {duration(walkingSeconds)}</strong>
                        <small>
                          {group.steps.length} instruction
                          {group.steps.length === 1 ? "" : "s"} · arrows show
                          direction on the map
                        </small>
                      </span>
                      <ChevronDown
                        size={16}
                        aria-hidden="true"
                        className={isOpen ? "rotate-180" : ""}
                      />
                    </button>
                    {isOpen && (
                      <ol className="route-walking-steps">
                        {group.steps.map((step) => (
                          <li
                            key={step.id}
                            className={`route-step ${step.mode.toLowerCase()}`}
                          >
                            <span className="route-step-icon">
                              {icon(step.mode)}
                            </span>
                            <span className="route-step-copy">
                              <strong>{step.instruction}</strong>
                              <small>
                                {clock(step.startTime)} ·{" "}
                                {duration(step.durationSeconds)}
                              </small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              }
              return group.steps.map((step) => (
                <li
                  key={step.id}
                  className={`route-step ${step.mode.toLowerCase()}`}
                >
                  <span className="route-step-icon">{icon(step.mode)}</span>
                  <span className="route-step-copy">
                    <strong>{step.instruction}</strong>
                    <small>
                      {clock(step.startTime)} · {duration(step.durationSeconds)}
                    </small>
                  </span>
                </li>
              ));
            })}
          </ol>
        )}
        {onStart && (
          <button
            type="button"
            className="button primary route-start-button"
            onClick={() => onStart(selected)}
          >
            Start this route
          </button>
        )}
      </div>
    </section>
  );
}
