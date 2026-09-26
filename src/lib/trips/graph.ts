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
import { chooseDecision, deterministicExplanation } from "./scoring";
import { timingDeadline } from "./validation";
import type {
  MobilitySnapshot,
  ScoredItinerary,
  TripPlanResponse,
  TripPlannerDependencies,
  TripRequest,
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
      const verified: VerifiedItinerary[] = [];
      const candidates = state.transitCandidates;
      for (const candidate of candidates) {
        verified.push(
          await verifyItinerary(candidate, state.request, dependencies, snapshot),
        );
      }
      const shouldTryDirect =
        state.request.mode !== "transit-walk" ||
        !candidates.length ||
        !verified.some((candidate) => candidate.verified);
      if (shouldTryDirect) {
        try {
          verified.push(
            await directRouteCandidate(
              state.request,
              dependencies,
              snapshot,
            ),
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
      }
      return {
        verifiedCandidates: verified,
        attempts: { ...state.attempts, walking: state.attempts.walking + 1 },
      };
    })
    .addNode("score_candidates", async (state) => {
      const scored = rankItineraries(state.verifiedCandidates, state.request);
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
        .slice(0, 2);
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
        plan: selected,
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

export async function replanTrip(
  request: TripRequest,
  currentPlan: VerifiedItinerary,
  currentPosition: [number, number],
  dependencies: TripPlannerDependencies,
) {
  const response = await planTrip(
    {
      ...request,
      origin: currentPosition,
    },
    dependencies,
  );
  if (!response || response.status !== "ok" || !response.plan) {
    return {
      action: "replan" as const,
      reasonCode: "no-feasible-alternative" as const,
      currentOption: undefined,
      recommendedOption: undefined,
      alternatives: [],
      warnings: response?.warnings || [],
      meta:
        response?.meta || {
          requestedAt: new Date().toISOString(),
          planner: "langgraph-trip-autopilot",
          snapshotId: null,
          feeds: [],
          attempts: { transit: 0, walking: 0 },
        },
    };
  }
  const currentScored = {
    ...currentPlan,
    arrivalBufferSeconds:
      timingDeadline(request.timing) === null
        ? null
        : Math.floor(
            (timingDeadline(request.timing)! -
              Date.parse(currentPlan.arrivalTime)) /
              1000,
          ),
    score: Number.MAX_SAFE_INTEGER,
    switchingCostSeconds: 0,
    riskPenaltySeconds: 0,
  };
  const decision = chooseDecision(
    currentScored,
    [response.plan, ...response.alternatives],
  );
  return {
    ...decision,
    explanation: response.explanation,
    meta: response.meta,
  };
}
