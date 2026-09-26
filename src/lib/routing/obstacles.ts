import { geometryBounds } from "@/lib/closures/normalize";
import type { ClosureFeature } from "@/lib/closures/types";
import type {
  AvoidancePolygon,
  ClassifiedObstacles,
  Coordinate,
  RouteFeature,
  RouteWarning,
} from "./types";

const METERS_PER_DEGREE = 111_320;

function expandedBounds(
  feature: ClosureFeature,
  bufferMeters: number,
): [number, number, number, number] {
  const [west, south, east, north] = geometryBounds(feature.geometry);
  const latitude = (south + north) / 2;
  const latitudeBuffer = bufferMeters / METERS_PER_DEGREE;
  const longitudeBuffer =
    bufferMeters /
    (METERS_PER_DEGREE * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));
  return [
    west - longitudeBuffer,
    south - latitudeBuffer,
    east + longitudeBuffer,
    north + latitudeBuffer,
  ];
}

export function classifyObstacles(
  features: ClosureFeature[],
  avoidClosureIds: string[] = [],
): ClassifiedObstacles {
  const requested = new Set(avoidClosureIds);
  const hard: ClosureFeature[] = [];
  const warnings: RouteWarning[] = [];

  for (const feature of features) {
    const explicitlyAvoided = requested.has(feature.properties.id);
    const pedestrianBlocked = feature.properties.pedestrianImpact === "blocked";
    if (explicitlyAvoided || pedestrianBlocked) {
      hard.push(feature);
      if (explicitlyAvoided && !pedestrianBlocked) {
        warnings.push({
          code: "approximate-obstacle",
          message:
            "A selected closure is being avoided, but pedestrian access is not confirmed.",
          closureIds: [feature.properties.id],
        });
      }
      continue;
    }
    if (feature.properties.pedestrianImpact === "unknown") {
      warnings.push({
        code: "uncertain-pedestrian-impact",
        message:
          "Some scheduled closures may affect the trip, but walking access has not been confirmed.",
        closureIds: [feature.properties.id],
      });
    }
  }
  return { hard, warnings: dedupeWarnings(warnings) };
}

function dedupeWarnings(warnings: RouteWarning[]) {
  const byCode = new Map<string, RouteWarning>();
  for (const warning of warnings) {
    const existing = byCode.get(warning.code);
    if (existing) {
      existing.closureIds = [
        ...new Set([...(existing.closureIds || []), ...(warning.closureIds || [])]),
      ];
    } else {
      byCode.set(warning.code, { ...warning });
    }
  }
  return [...byCode.values()];
}

export function buildAvoidancePolygons(
  features: ClosureFeature[],
  bufferMeters = 12,
): AvoidancePolygon {
  return {
    type: "MultiPolygon",
    coordinates: features.map((feature) => {
      const [west, south, east, north] = expandedBounds(feature, bufferMeters);
      return [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ];
    }),
  };
}

function orientation(a: Coordinate, b: Coordinate, c: Coordinate) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) -
    (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(value) < 1e-12 ? 0 : value > 0 ? 1 : 2;
}

function onSegment(a: Coordinate, b: Coordinate, c: Coordinate) {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}

function segmentsIntersect(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first !== second && third !== fourth) return true;
  return (
    (first === 0 && onSegment(a, c, b)) ||
    (second === 0 && onSegment(a, d, b)) ||
    (third === 0 && onSegment(c, a, d)) ||
    (fourth === 0 && onSegment(c, b, d))
  );
}

function pointInBounds(
  [longitude, latitude]: Coordinate,
  [west, south, east, north]: [number, number, number, number],
) {
  return (
    longitude >= west &&
    longitude <= east &&
    latitude >= south &&
    latitude <= north
  );
}

export function routeIntersectsObstacles(
  route: RouteFeature,
  obstacles: ClosureFeature[],
  bufferMeters = 12,
) {
  const routeCoordinates = route.geometry.coordinates;
  return obstacles.some((obstacle) => {
    const bounds = expandedBounds(obstacle, bufferMeters);
    for (let index = 1; index < routeCoordinates.length; index += 1) {
      const start = routeCoordinates[index - 1] as Coordinate;
      const end = routeCoordinates[index] as Coordinate;
      if (
        pointInBounds(start, bounds) ||
        pointInBounds(end, bounds) ||
        [
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[1]],
          ],
          [
            [bounds[2], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          [
            [bounds[2], bounds[3]],
            [bounds[0], bounds[3]],
          ],
          [
            [bounds[0], bounds[3]],
            [bounds[0], bounds[1]],
          ],
        ].some(([cornerStart, cornerEnd]) =>
          segmentsIntersect(
            start,
            end,
            cornerStart as Coordinate,
            cornerEnd as Coordinate,
          ),
        )
      )
        return true;
    }
    return false;
  });
}
