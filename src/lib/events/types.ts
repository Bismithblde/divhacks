import type { ClosureFeature } from "@/lib/closures/types";

export type EventImpact =
  | "fully-closed"
  | "partially-closed"
  | "crowded"
  | "likely-open"
  | "uncertain";

export type EventSummary = {
  tags: string[];
  keywords: string[];
  about: string[];
  roadImpact: EventImpact;
  pedestrianImpact: EventImpact;
  confidence: "low" | "medium" | "high";
  roadReason: string;
  pedestrianReason: string;
  provider: "gemini" | "source";
};

export type EventAccessOverride =
  | "no-closure"
  | "roads-closed"
  | "sidewalk-closed"
  | "sidewalk-crowded";

export type EventSummaryInput = Pick<
  ClosureFeature["properties"],
  | "id"
  | "title"
  | "category"
  | "borough"
  | "location"
  | "start"
  | "end"
  | "eventStart"
  | "eventEnd"
  | "permitStatus"
  | "pedestrianImpact"
  | "vehicleImpact"
>;

function cleanTag(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}&+\- /]/gu, "")
    .slice(0, 28);
}

export function sourceEventTags(feature: ClosureFeature) {
  const values = [
    cleanTag(feature.properties.category),
    cleanTag(feature.properties.borough),
  ].filter(Boolean);
  return [...new Set(values)].slice(0, 2);
}
