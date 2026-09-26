import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
} from "geojson";

export type ClosureKind = "event" | "construction";
export type ClosureGeometry = LineString | MultiLineString | Point;
export type ClosureProperties = {
  id: string;
  title: string;
  location: string;
  borough: string;
  kind: ClosureKind;
  category: string;
  start: number;
  end: number;
  eventStart: number | null;
  eventEnd: number | null;
  permitStatus: string;
  source: string;
  sourceUrl: string;
  pedestrianImpact: "unknown" | "blocked" | "open";
  vehicleImpact?: "unknown" | "blocked" | "clear";
};
export type ClosureFeature = Feature<ClosureGeometry, ClosureProperties>;
export type SourceStatus = {
  id: string;
  label: string;
  url: string;
  status: "ok" | "stale" | "unavailable";
  updatedAt: string | null;
  fetchedAt: string | null;
  total: number;
  unmapped: number;
  message?: string;
};
export type ClosureResponse = FeatureCollection<
  ClosureGeometry,
  ClosureProperties
> & {
  meta: {
    fetchedAt: string;
    start: number;
    end: number;
    days: number;
    sources: SourceStatus[];
    complete: boolean;
    coverage: string;
  };
};
