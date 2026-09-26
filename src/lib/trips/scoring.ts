import type {
  ScoredItinerary,
  TripDecision,
  TripExplanation,
  TripWarning,
  VerifiedItinerary,
} from "./types";

export const SWITCH_MARGIN_SECONDS = 5 * 60;
export const SWITCH_COOLDOWN_MS = 3 * 60_000;

function riskPenalty(itinerary: VerifiedItinerary) {
  let penalty = 0;
  if (itinerary.status === "stale") penalty += 8 * 60;
  penalty += itinerary.alerts.reduce(
    (total, alert) =>
      total +
      (alert.severity === "critical"
        ? 15 * 60
        : alert.severity === "warning"
          ? 6 * 60
          : 60),
    0,
  );
  penalty += itinerary.warnings.length * 90;
  return penalty;
}

function switchingCost(itinerary: VerifiedItinerary) {
  const walking = itinerary.walkingSeconds;
  const transfers = itinerary.transfers;
  return Math.min(12 * 60, walking / 4) + transfers * 90;
}

export function scoreItinerary(
  itinerary: VerifiedItinerary,
  deadline: number | null,
): ScoredItinerary {
  const arrival = Date.parse(itinerary.arrivalTime);
  const arrivalBufferSeconds =
    deadline === null ? null : Math.floor((deadline - arrival) / 1000);
  const riskPenaltySeconds = riskPenalty(itinerary);
  const switchingCostSeconds = switchingCost(itinerary);
  const latePenalty =
    arrivalBufferSeconds !== null && arrivalBufferSeconds < 0
      ? Math.abs(arrivalBufferSeconds) * 20
      : 0;
  const deadlineBonus =
    arrivalBufferSeconds !== null && arrivalBufferSeconds >= 0
      ? Math.min(arrivalBufferSeconds, 30 * 60) * 2
      : 0;
  const score =
    itinerary.durationSeconds +
    itinerary.transfers * 120 +
    itinerary.waitingSeconds * 0.4 +
    riskPenaltySeconds +
    latePenalty +
    switchingCostSeconds -
    deadlineBonus;
  return {
    ...itinerary,
    arrivalBufferSeconds,
    score,
    switchingCostSeconds,
    riskPenaltySeconds,
  };
}

export function compareItineraries(
  itineraries: VerifiedItinerary[],
  deadline: number | null,
) {
  return itineraries
    .map((itinerary) => scoreItinerary(itinerary, deadline))
    .sort((a, b) => {
      const aFeasible =
        a.arrivalBufferSeconds === null || a.arrivalBufferSeconds >= 0;
      const bFeasible =
        b.arrivalBufferSeconds === null || b.arrivalBufferSeconds >= 0;
      if (aFeasible !== bFeasible) return aFeasible ? -1 : 1;
      return a.score - b.score;
    });
}

export function chooseDecision(
  current: ScoredItinerary | null,
  alternatives: ScoredItinerary[],
  now = Date.now(),
  lastDecisionAt = 0,
): TripDecision {
  const ordered = [...alternatives].sort((a, b) => a.score - b.score);
  const best = ordered[0];
  if (!best && !current) {
    return {
      action: "replan",
      reasonCode: "no-feasible-alternative",
      alternatives: [],
      warnings: [],
    };
  }
  if (!best) {
    return {
      action: "stay",
      reasonCode: "current-plan-still-best",
      currentOption: current || undefined,
      alternatives: [],
      warnings: current?.warnings || [],
    };
  }
  if (!current) {
    return {
      action: "switch",
      reasonCode: "alternate-arrives-earlier",
      recommendedOption: best,
      alternatives: ordered.slice(1),
      warnings: best.warnings,
    };
  }
  const currentArrival = Date.parse(current.arrivalTime);
  const bestArrival = Date.parse(best.arrivalTime);
  const currentMissesDeadline =
    current.arrivalBufferSeconds !== null &&
    current.arrivalBufferSeconds < 0;
  const serviceCancelled = current.alerts.some(
    (alert) => alert.severity === "critical",
  );
  const improvement = (currentArrival - bestArrival) / 1000;
  const cooledDown = now - lastDecisionAt >= SWITCH_COOLDOWN_MS;
  const shouldSwitch =
    cooledDown &&
    (serviceCancelled ||
      currentMissesDeadline ||
      (best.id !== current.id && improvement >= SWITCH_MARGIN_SECONDS));
  return {
    action: shouldSwitch ? "switch" : "stay",
    reasonCode: serviceCancelled
      ? "service-cancelled"
      : currentMissesDeadline
        ? "current-plan-misses-deadline"
        : shouldSwitch
          ? "alternate-arrives-earlier"
          : "current-plan-still-best",
    currentOption: current,
    recommendedOption: shouldSwitch ? best : current,
    alternatives: ordered.filter((candidate) => candidate.id !== current.id),
    warnings: [
      ...current.warnings,
      ...(shouldSwitch ? best.warnings : []),
    ].filter(
      (warning, index, all) =>
        all.findIndex((item) => item.code === warning.code) === index,
    ),
  };
}

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60));
}

export function deterministicExplanation(
  decision: {
    action: "stay" | "switch" | "continue" | "recheck";
    currentOption?: ScoredItinerary;
    recommendedOption?: ScoredItinerary;
    warnings: TripWarning[];
  },
  deadline: number | null,
): TripExplanation {
  const selected = decision.recommendedOption || decision.currentOption;
  if (!selected) {
    return {
      headline: "No verified plan yet",
      action: "recheck",
      reason: "There is not enough current data to recommend a trip.",
      steps: ["Check again when transit data is available."],
      caveats: decision.warnings.map((warning) => warning.message),
      provider: "deterministic-template",
    };
  }
  const buffer =
    selected.arrivalBufferSeconds === null
      ? null
      : selected.arrivalBufferSeconds;
  const late =
    buffer !== null && buffer < 0
      ? ` about ${minutes(Math.abs(buffer))} min late`
      : "";
  const arrival = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(selected.arrivalTime));
  const mode = selected.legs
    .filter((leg) => leg.mode !== "WALK")
    .map((leg) => leg.routeName || leg.mode.toLowerCase())
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(" then ");
  const action =
    decision.action === "switch"
      ? "switch"
      : decision.action === "stay"
        ? "stay"
        : "continue";
  const headline =
    action === "switch"
      ? `Switch to arrive around ${arrival}`
      : action === "stay"
        ? `Stay on the current plan and arrive around ${arrival}`
        : `Continue toward ${arrival}`;
  const reason =
    action === "switch" && decision.currentOption
      ? `The recommended option is ${minutes(
          Math.max(
            60,
            (Date.parse(decision.currentOption.arrivalTime) -
              Date.parse(selected.arrivalTime)) /
              1000,
          ),
        )} min earlier after walking and transfer time.`
      : `This is the best verified option${deadline ? ` for your ${arrival} deadline` : ""}${late}.`;
  return {
    headline,
    action,
    reason,
    steps: [
      mode ? `Use ${mode}.` : "Follow the walking route.",
      `${selected.transfers} transfer${selected.transfers === 1 ? "" : "s"} · ${minutes(selected.walkingSeconds)} min walking.`,
    ],
    caveats: decision.warnings.map((warning) => warning.message),
    provider: "deterministic-template",
  };
}
