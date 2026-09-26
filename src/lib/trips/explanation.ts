import type {
  ScoredItinerary,
  TripExplanation,
  TripWarning,
} from "./types";
import { deterministicExplanation } from "./scoring";

type ExplanationFacts = {
  action: "stay" | "switch" | "continue" | "recheck";
  current?: {
    arrival: string;
    waitMinutes: number;
    transfers: number;
  };
  recommended?: {
    arrival: string;
    walkMinutes: number;
    transfers: number;
  };
  deadline: string | null;
  warnings: string[];
  allowedClaims: string[];
};

function factsFor(
  selected: ScoredItinerary,
  current: ScoredItinerary | undefined,
  action: "stay" | "switch" | "continue" | "recheck",
  deadline: number | null,
  warnings: TripWarning[],
): ExplanationFacts {
  const display = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date(value));
  return {
    action,
    current: current
      ? {
          arrival: display(current.arrivalTime),
          waitMinutes: Math.round(current.waitingSeconds / 60),
          transfers: current.transfers,
        }
      : undefined,
    recommended: {
      arrival: display(selected.arrivalTime),
      walkMinutes: Math.round(selected.walkingSeconds / 60),
      transfers: selected.transfers,
    },
    deadline: deadline ? display(new Date(deadline).toISOString()) : null,
    warnings: warnings.map((warning) => warning.message),
    allowedClaims: [
      "selected action",
      "verified arrival estimate",
      "walking time",
      "transfer count",
      "provided warnings",
    ],
  };
}

function validOutput(value: unknown): value is Omit<TripExplanation, "provider"> {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    ["stay", "switch", "continue", "recheck"].includes(String(result.action)) &&
    typeof result.headline === "string" &&
    result.headline.length > 0 &&
    result.headline.length <= 160 &&
    typeof result.reason === "string" &&
    result.reason.length > 0 &&
    result.reason.length <= 300 &&
    Array.isArray(result.steps) &&
    result.steps.length <= 4 &&
    result.steps.every(
      (step) => typeof step === "string" && step.length <= 180,
    ) &&
    Array.isArray(result.caveats) &&
    result.caveats.length <= 4 &&
    result.caveats.every(
      (caveat) => typeof caveat === "string" && caveat.length <= 180,
    )
  );
}

function numericTokens(value: string) {
  return value.match(/\b\d+(?:\.\d+)?\b/g) || [];
}

function containsUnsupportedNumbers(output: string, facts: ExplanationFacts) {
  const allowed = new Set(
    numericTokens(JSON.stringify(facts)).map((token) => Number(token)),
  );
  return numericTokens(output).some((token) => !allowed.has(Number(token)));
}

export async function explainPlan(
  selected: ScoredItinerary,
  current: ScoredItinerary | undefined,
  action: "stay" | "switch" | "continue" | "recheck",
  alternatives: ScoredItinerary[],
  warnings: TripWarning[],
  deadline: number | null,
): Promise<TripExplanation> {
  const fallback = deterministicExplanation(
    {
      action,
      currentOption: current,
      recommendedOption: selected,
      warnings,
    },
    deadline,
  );
  const key = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!key || !baseUrl || !model) return fallback;
  const facts = factsFor(selected, current, action, deadline, warnings);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 280,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Explain a transit recommendation using only the supplied JSON facts. Never calculate a new time, add a route, claim accessibility, or invent a warning. Return JSON with headline, action, reason, steps, and caveats.",
        },
        {
          role: "user",
          content: JSON.stringify(facts),
        },
      ],
    }),
    signal: AbortSignal.timeout(4_000),
    cache: "no-store",
  });
  if (!response.ok) return fallback;
  try {
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const parsed = JSON.parse(content) as unknown;
    if (!validOutput(parsed)) return fallback;
    const text = JSON.stringify(parsed);
    if (containsUnsupportedNumbers(text, facts)) return fallback;
    if (parsed.action !== action) return fallback;
    return { ...parsed, provider: "grounded-model" };
  } catch {
    return fallback;
  }
}

