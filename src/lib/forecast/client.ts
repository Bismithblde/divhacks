import type { ClosureFeature, ClosureGeometry } from "@/lib/closures/types";

// Shape of GET /api/forecast, shared by the route and the map UI.

export type ForecastApiPrediction = {
  id: string;
  title: string;
  borough: string;
  date: string;
  start: string | null;
  end: string | null;
  pattern: string;
  confidence: "high" | "medium";
  yearsObserved: number[];
  yearsExpected: number;
  closureType: string;
  pedestrianImpact: "unknown" | "blocked" | "open";
  vehicleImpact: "unknown" | "blocked" | "clear";
  locations: string[];
  geometry: ClosureGeometry | null;
};

export type ForecastApiResponse = {
  status: "ok";
  from: string;
  to: string;
  predictions: ForecastApiPrediction[];
  meta: {
    kind: "prediction";
    disclaimer: string;
    generatedAt: string;
    source: string;
    historyFrom: string;
    historyTo: string;
  };
};

export const PREDICTION_SOURCE_LABEL = "Predicted from past NYC permits";

function titleCaseLocation(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bBetween\b/g, "between")
    .replace(/\bAnd\b/g, "and");
}

export function predictionLocation(prediction: ForecastApiPrediction) {
  return prediction.locations.length
    ? prediction.locations.slice(0, 3).map(titleCaseLocation).join("; ") +
        (prediction.locations.length > 3
          ? ` and ${prediction.locations.length - 3} more`
          : "")
    : "Location not listed";
}

/** Map feature for a prediction, or null when its streets could not be mapped. */
export function predictionFeature(
  prediction: ForecastApiPrediction,
  sourceUrl: string,
): ClosureFeature | null {
  const start = prediction.start ? Date.parse(prediction.start) : NaN;
  const end = prediction.end ? Date.parse(prediction.end) : NaN;
  if (!prediction.geometry || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return {
    type: "Feature",
    id: prediction.id,
    geometry: prediction.geometry,
    properties: {
      id: prediction.id,
      title: prediction.title,
      location: predictionLocation(prediction),
      borough: prediction.borough,
      kind: "event",
      category: "Predicted event",
      start,
      end,
      eventStart: start,
      eventEnd: end,
      permitStatus: "Predicted, not yet permitted",
      source: PREDICTION_SOURCE_LABEL,
      sourceUrl,
      pedestrianImpact: prediction.pedestrianImpact,
      vehicleImpact: prediction.vehicleImpact,
      predicted: true,
    },
  };
}
