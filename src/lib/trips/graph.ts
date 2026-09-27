import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import {
  directRouteCandidate,
  rankItineraries,
  verifyItinerary,
  warningsForPlan,
} from "./planner";
import {
  chooseDecision,
  deterministicExplanation,
  SWITCH_COOLDOWN_MS,
} from "./scoring";
import { routeOptionForItinerary } from "./steps";
import {
  currentLegIndex,
  missedTransitDeparture,
  sameService,
} from "./active";
import { timingDeadline } from "./validation";
import type {
  MobilitySnapshot,
  RouteOption,
  ScoredItinerary,
  TripDecision,
  TripLeg,
  TripPlanResponse,
  TripPlannerDependencies,
  TripRequest,
  TransitCheckIn,
  TripWarning,
  VerifiedItinerary,
} from "./types";

function last<T>(defaultValue: () => T) {
  return Annotation<T>({
    reducer: (_left, right) => right,
    default: defaultValue,
  });
}

const TripState = Annotation.Root({
  request: Annotation<TripRequest>(),
  snapshot: last<MobilitySnapshot | null>(() => null),
  transitCandidates: last<VerifiedItinerary[]>(() => []),
  verifiedCandidates: last<VerifiedItinerary[]>(() => []),
  scoredCandidates: last<ScoredItinerary[]>(() => []),
  warnings: Annotation<TripWarning[]>({
    reducer: (left, right) => [...left, ...right].slice(-24),
    default: () => [],
  }),
  failures: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right].slice(-8),
    default: () => [],
  }),
  attempts: last<{ transit: number; walking: number }>(() => ({
    transit: 0,
    walking: 0,
  })),
  selected: last<ScoredItinerary | null>(() => null),
  response: last<TripPlanResponse | null>(() => null),
});

export type TripGraphState = typeof TripState.State;

function baseMeta(state: TripGraphState): TripPlanResponse["meta"] {
  return {
    requestedAt: new Date().toISOString(),
    planner: "langgraph-trip-autopilot",
    snapshotId: state.snapshot?.id || null,
    feeds: state.snapshot?.feeds || [],
    attempts: state.attempts,
  };
}

export function createTripGraph(dependencies: TripPlannerDependencies) {
  const graph = new StateGraph(TripState)
    .addNode("load_snapshot", async () => ({
      snapshot: await dependencies.loadSnapshot(),
    }))
    .addNode("query_transit", async (state) => {
      if (state.request.mode !== "transit-walk") return {};
      try {
        const candidates = await dependencies.transitRouter.plan({
          origin: state.request.origin,
          destination: state.request.destination,
          timing: state.request.timing,
          constraints: state.request.constraints,
        });
        return {
          transitCandidates: candidates as VerifiedItinerary[],
          attempts: { ...state.attempts, transit: state.attempts.transit + 1 },
        };
      } catch (error) {
        return {
          failures: [
            error instanceof Error
              ? error.message
              : "Transit provider unavailable.",
          ],
          warnings: [
            {
              code: "provider-limited" as const,
              message:
                "Live transit planning is unavailable. A direct walking plan may still be possible.",
              source: "OpenTripPlanner",
            },
          ],
          attempts: { ...state.attempts, transit: state.attempts.transit + 1 },
        };
      }
    })
    .addNode("verify_candidates", async (state) => {
      const snapshot = state.snapshot;
      if (!snapshot) return {};
      const candidates = state.transitCandidates;
      const verified = await Promise.all(
        candidates.map((candidate) =>
          verifyItinerary(candidate, state.request, dependencies, snapshot),
        ),
      );
      const shouldTryDirect =
        state.request.mode !== "transit-walk" ||
        !candidates.length ||
        !verified.some((candidate) => candidate.verified);
      if (!shouldTryDirect) {
        return {
          verifiedCandidates: verified,
          attempts: { ...state.attempts, walking: state.attempts.walking + 1 },
        };
      }
      let direct: VerifiedItinerary;
      try {
        direct = await directRouteCandidate(
          state.request,
          dependencies,
          snapshot,
        );
      } catch (error) {
        return {
          verifiedCandidates: verified,
          failures: [
            error instanceof Error
              ? error.message
              : state.request.mode === "driving-car"
                ? "Driving provider unavailable."
                : "Walking provider unavailable.",
          ],
          warnings: [
            {
              code: "provider-limited" as const,
              message:
                state.request.mode === "driving-car"
                  ? "A verified driving route could not be calculated."
                  : "A verified walking fallback could not be calculated.",
              source: "OpenRouteService",
            },
          ],
          attempts: { ...state.attempts, walking: state.attempts.walking + 1 },
        };
      }
      return {
        verifiedCandidates: [...verified, direct],
        attempts: { ...state.attempts, walking: state.attempts.walking + 1 },
      };
    })
    .addNode("score_candidates", async (state) => {
      let candidates = state.verifiedCandidates;
      if (
        state.request.mode === "transit-walk" &&
        dependencies.transitRouter.enrichRealtime
      ) {
        const preliminary = rankItineraries(candidates, state.request);
        const enriched = await dependencies.transitRouter.enrichRealtime(
          preliminary.slice(0, 2),
        );
        const updates = new Map(enriched.map((candidate) => [candidate.id, candidate]));
        candidates = candidates.map((candidate) => {
          const update = updates.get(candidate.id);
          return update ? { ...candidate, ...update } : candidate;
        });
      }
      const scored = rankItineraries(candidates, state.request);
      const warnings = warningsForPlan(scored[0], state.snapshot!);
      return {
        scoredCandidates: scored,
        selected: scored[0] || null,
        warnings,
      };
    })
    .addNode("compose_response", async (state) => {
      const selected = state.selected;
      const warnings = [...state.warnings];
      if (!selected) {
        const response: TripPlanResponse = {
          status: state.failures.length ? "unavailable" : "no-plan",
          alternatives: [],
          warnings,
          error:
            state.failures[0] ||
            "No verified route could be found for this trip.",
          meta: baseMeta(state),
        };
        return { response };
      }
      const alternatives = state.scoredCandidates
        .filter((candidate) => candidate.id !== selected.id)
        .slice(0, 2)
        .map(routeOptionForItinerary);
      const deadline = timingDeadline(state.request.timing);
      const explanation = await dependencies
        .explain(selected, alternatives, warnings, deadline)
        .catch(() =>
          deterministicExplanation(
            {
              action: "continue",
              recommendedOption: selected,
              warnings,
            },
            deadline,
          ),
        );
      const response: TripPlanResponse = {
        status: "ok",
        plan: routeOptionForItinerary(selected),
        alternatives,
        explanation,
        warnings,
        meta: baseMeta(state),
      };
      return { response };
    })
    .addNode("compose_empty_response", async (state) => {
      const response: TripPlanResponse = {
        status: state.failures.length ? "unavailable" : "no-plan",
        alternatives: [],
        warnings: state.warnings,
        error:
          state.failures[0] ||
          "No verified route could be found for this trip.",
        meta: baseMeta(state),
      };
      return { response };
    })
    .addEdge(START, "load_snapshot")
    .addEdge("load_snapshot", "query_transit")
    .addEdge("query_transit", "verify_candidates")
    .addEdge("verify_candidates", "score_candidates")
    .addConditionalEdges(
      "score_candidates",
      (state) => (state.scoredCandidates.length ? "compose" : "empty"),
      {
        compose: "compose_response",
        empty: "compose_empty_response",
      },
    )
    .addEdge("compose_response", END)
    .addEdge("compose_empty_response", END)
    .compile();
  return graph;
}

export async function planTrip(
  request: TripRequest,
  dependencies: TripPlannerDependencies,
) {
  const graph = createTripGraph(dependencies);
  const result = await graph.invoke({
    request,
  });
  return result.response;
}

type Disruption = {
  reasonCode:
    | "missed-departure"
    | "service-cancelled"
    | "service-late"
    | "vehicle-not-here";
} | null;

const DecisionState = Annotation.Root({
  request: Annotation<TripRequest>(),
  currentPlan: Annotation<VerifiedItinerary>(),
  currentPosition: Annotation<[number, number]>(),
  transitObservation: last<TransitCheckIn | null>(() => null),
  lastDecisionAt: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  now: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => Date.now(),
  }),
  activeLeg: last<TripLeg | null>(() => null),
  disruption: last<Disruption>(() => null),
  response: last<TripPlanResponse | null>(() => null),
  currentScored: last<ScoredItinerary | null>(() => null),
  decision: last<TripDecision | null>(() => null),
});

function cancelledService(plan: VerifiedItinerary) {
  const messages = [
    ...plan.alerts.map((alert) => alert.message),
    ...plan.legs.map((leg) => leg.alert).filter(Boolean),
  ];
  return messages.some((message) =>
    /cancel|suspend|no service|not running/i.test(message || ""),
  );
}

function classifyDisruption(
  plan: VerifiedItinerary,
  activeLeg: TripLeg | null,
  now: number,
  observation: TransitCheckIn | null,
): Disruption {
  if (cancelledService(plan)) return { reasonCode: "service-cancelled" };
  const appliesToActiveLeg =
    Boolean(activeLeg) && observation?.legId === activeLeg?.id;
  if (appliesToActiveLeg && observation?.response === "not-arrived") {
    return { reasonCode: "vehicle-not-here" };
  }
  if (
    activeLeg &&
    missedTransitDeparture(
      activeLeg,
      now,
      appliesToActiveLeg && observation?.response === "arrived",
    )
  ) {
    return { reasonCode: "missed-departure" };
  }
  if (
    activeLeg &&
    (activeLeg.mode === "BUS" || activeLeg.mode === "SUBWAY") &&
    (activeLeg.delaySeconds || 0) >= 5 * 60
  ) {
    return { reasonCode: "service-late" };
  }
  return null;
}

function currentScore(
  currentPlan: VerifiedItinerary,
  request: TripRequest,
): ScoredItinerary {
  const deadline = timingDeadline(request.timing);
  return {
    ...currentPlan,
    arrivalBufferSeconds:
      deadline === null
        ? null
        : Math.floor((deadline - Date.parse(currentPlan.arrivalTime)) / 1000),
    score: Number.MAX_SAFE_INTEGER,
    switchingCostSeconds: 0,
    riskPenaltySeconds: 0,
  };
}

function decisionOptions(
  currentOption: RouteOption,
  candidates: RouteOption[],
  decision: TripDecision,
) {
  return [
    {
      id: "keep-current",
      action: "keep-current" as const,
      label: "Keep current route",
      description: `Continue toward ${
        currentOption.legs[currentOption.legs.length - 1]?.to.name ||
        "your destination"
      }.`,
      recommended: decision.action === "stay",
      option: currentOption,
    },
    ...candidates
      .filter((candidate) => candidate.id !== currentOption.id)
      .map((option) => {
        const walking = option.legs.every((leg) => leg.mode === "WALK");
        const wait = !walking && sameService(currentOption, option);
        return {
          id: option.id,
          action: walking
            ? ("walk" as const)
            : wait
              ? ("wait" as const)
              : ("switch" as const),
          label: walking
            ? "Walk instead"
            : wait
              ? "Wait for the next service"
              : "Switch route",
          description: `Arrive around ${new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          }).format(new Date(option.arrivalTime))}.`,
          recommended:
            decision.recommendedOption?.id === option.id ||
            (decision.action === "switch" &&
              decision.reasonCode === "missed-departure" &&
              option.id === candidates[0]?.id),
          option,
        };
      }),
  ];
}

function createDecisionGraph(dependencies: TripPlannerDependencies) {
  return new StateGraph(DecisionState)
    .addNode("detectCurrentLeg", async (state) => {
      const index = currentLegIndex(state.currentPlan, state.now);
      return { activeLeg: state.currentPlan.legs[index] || null };
    })
    .addNode("classifyDisruption", async (state) => ({
      disruption: classifyDisruption(
        state.currentPlan,
        state.activeLeg,
        state.now,
        state.transitObservation,
      ),
    }))
    .addNode("queryAlternatives", async (state) => ({
      response: await planTrip(state.request, dependencies),
    }))
    .addNode("compareWaitVsSwitch", async (state) => {
      const response = state.response;
      const current = currentScore(state.currentPlan, state.request);
      if (!response || response.status !== "ok" || !response.plan) {
        return {
          currentScored: current,
          decision: {
            action: "replan" as const,
            reasonCode: "no-feasible-alternative" as const,
            currentOption: current,
            alternatives: [],
            warnings: response?.warnings || current.warnings,
          },
        };
      }
      const candidates = [response.plan, ...response.alternatives];
      const vehicleMissing =
        state.disruption?.reasonCode === "vehicle-not-here";
      const freshCurrent = vehicleMissing
        ? candidates.find((candidate) =>
            sameService(state.currentPlan, candidate),
          ) || null
        : current;
      return {
        currentScored: freshCurrent || current,
        decision: chooseDecision(
          freshCurrent,
          candidates.filter((candidate) => candidate.id !== freshCurrent?.id),
          state.now,
          state.lastDecisionAt,
        ),
      };
    })
    .addNode("applyCooldown", async (state) => {
      const decision = state.decision;
      if (!decision) return {};
      const cooledDown =
        state.now - state.lastDecisionAt >= SWITCH_COOLDOWN_MS;
      if (!cooledDown && decision.action === "switch") {
        return {
          decision: {
            ...decision,
            action: "stay" as const,
            reasonCode: "current-plan-still-best" as const,
            recommendedOption: state.currentScored || decision.currentOption,
          },
        };
      }
      if (state.disruption?.reasonCode === "vehicle-not-here") {
        return {
          decision: {
            ...decision,
            reasonCode: "vehicle-not-here" as const,
          },
        };
      }
      if (
        cooledDown &&
        state.disruption &&
        state.response?.plan &&
        decision.action === "stay"
      ) {
        return {
          decision: {
            ...decision,
            action: "switch" as const,
            reasonCode: state.disruption.reasonCode,
            recommendedOption: state.response.plan,
          },
        };
      }
      return {};
    })
    .addNode("composeDecision", async (state) => {
      const decision = state.decision;
      const response = state.response;
      const current = state.currentScored;
      if (!decision || !current) {
        return {
          decision: {
            action: "replan" as const,
            reasonCode: "no-feasible-alternative" as const,
            alternatives: [],
            warnings: [],
          },
        };
      }
      const currentOption = routeOptionForItinerary(current);
      const candidates = response?.status === "ok" && response.plan
        ? [response.plan, ...response.alternatives]
        : [];
      return {
        decision: {
          ...decision,
          options: decisionOptions(currentOption, candidates, decision),
          explanation:
            response?.explanation ||
            deterministicExplanation(
              decision,
              timingDeadline(state.request.timing),
            ),
          meta: response?.meta,
        },
      };
    })
    .addEdge(START, "detectCurrentLeg")
    .addEdge("detectCurrentLeg", "classifyDisruption")
    .addEdge("classifyDisruption", "queryAlternatives")
    .addEdge("queryAlternatives", "compareWaitVsSwitch")
    .addEdge("compareWaitVsSwitch", "applyCooldown")
    .addEdge("applyCooldown", "composeDecision")
    .addEdge("composeDecision", END)
    .compile();
}

export async function replanTrip(
  request: TripRequest,
  currentPlan: VerifiedItinerary,
  currentPosition: [number, number],
  dependencies: TripPlannerDependencies,
  lastDecisionAt = 0,
  transitObservation: TransitCheckIn | null = null,
) {
  const graph = createDecisionGraph(dependencies);
  const result = await graph.invoke({
    request: { ...request, origin: currentPosition },
    currentPlan,
    currentPosition,
    lastDecisionAt,
    transitObservation,
    now: Date.now(),
  });
  return (
    result.decision || {
      action: "replan" as const,
      reasonCode: "no-feasible-alternative" as const,
      alternatives: [],
      warnings: [],
    }
  );
}
