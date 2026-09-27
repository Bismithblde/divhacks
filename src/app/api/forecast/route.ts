import forecastData from "@/data/forecast.json";
import { impactFor } from "@/lib/closures/permitted-events";
import { newYorkDateTimeToIso } from "@/lib/closures/time";
import type {
  ForecastApiPrediction,
  ForecastApiResponse,
} from "@/lib/forecast/client";
import {
  addDays,
  predictionsBetween,
  type ForecastFile,
} from "@/lib/forecast/recurrence";

export const runtime = "nodejs";

// Built offline by scripts/build-forecast.ts; this route only reads it.
const forecast = forecastData as ForecastFile;
const MAX_RANGE_DAYS = 62;
const DISCLAIMER =
  "Predicted from past NYC permits, not a confirmed closure. Dates, times, and streets can change; check live closures closer to the day.";

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function rangeDays(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("date") || params.get("from");
  const to = params.get("date") || params.get("to") || from;
  if (!validDate(from) || !validDate(to)) {
    return Response.json(
      { error: "Pass ?date=YYYY-MM-DD, or ?from=YYYY-MM-DD&to=YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (to < from || rangeDays(from, to) > MAX_RANGE_DAYS) {
    return Response.json(
      { error: `The date range must run forward and span at most ${MAX_RANGE_DAYS} days.` },
      { status: 400 },
    );
  }

  const predictions = predictionsBetween(forecast.series, from, to).map(
    ({ series, date, from: firstDay, to: lastDay }): ForecastApiPrediction => {
      const endDay = series.endTime < series.startTime ? addDays(lastDay, 1) : lastDay;
      return {
        id: `forecast-${series.id}-${date}`,
        title: series.title,
        borough: series.borough,
        date,
        start: newYorkDateTimeToIso(`${firstDay}T${series.startTime}`),
        end: newYorkDateTimeToIso(`${endDay}T${series.endTime}`),
        pattern: series.ruleLabel,
        confidence: series.confidence,
        yearsObserved: series.yearsObserved,
        yearsExpected: series.yearsExpected,
        closureType: series.closureType,
        ...impactFor(series.closureType),
        locations: series.locations,
        geometry: series.geometry,
      };
    },
  );

  return Response.json(
    {
      status: "ok",
      from,
      to,
      predictions,
      meta: {
        kind: "prediction",
        disclaimer: DISCLAIMER,
        generatedAt: forecast.generatedAt,
        source: forecast.source,
        historyFrom: forecast.historyFrom,
        historyTo: forecast.historyTo,
      },
    } satisfies ForecastApiResponse,
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
