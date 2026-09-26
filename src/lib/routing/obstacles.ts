import { geometryBounds } from "@/lib/closures/normalize";
import type { ClosureFeature, ClosureGeometry } from "@/lib/closures/types";
import type {
  AvoidancePolygon,
  ClassifiedObstacles,
  Coordinate,
  RouteFeature,
  RouteWarning,
} from "./types";

const METERS_PER_DEGREE = 111_320;

type Segment = [Coordinate, Coordinate];

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

function geometrySegments(geometry: ClosureGeometry): Segment[] {
  if (geometry.type === "Point") return [];
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.coordinates;
  return lines.flatMap((line) =>
    line.slice(1).map(
      (point, index) =>
        [line[index] as Coordinate, point as Coordinate] as Segment,
    ),
  );
}

function longitudeMeters(latitude: number) {
  return (
    METERS_PER_DEGREE *
    Math.max(Math.cos((latitude * Math.PI) / 180), 0.2)
  );
}

function pointDistanceMeters(a: Coordinate, b: Coordinate) {
  const latitude = (a[1] + b[1]) / 2;
  return Math.hypot(
    (a[0] - b[0]) * longitudeMeters(latitude),
    (a[1] - b[1]) * METERS_PER_DEGREE,
  );
}

function pointToSegmentDistanceMeters(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
) {
  const latitude = (point[1] + start[1] + end[1]) / 3;
  const scaleX = longitudeMeters(latitude);
  const scaleY = METERS_PER_DEGREE;
  const px = point[0] * scaleX;
  const py = point[1] * scaleY;
  const ax = start[0] * scaleX;
  const ay = start[1] * scaleY;
  const bx = end[0] * scaleX;
  const by = end[1] * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsDistanceMeters(
  firstStart: Coordinate,
  firstEnd: Coordinate,
  secondStart: Coordinate,
  secondEnd: Coordinate,
) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd))
    return 0;
  return Math.min(
    pointToSegmentDistanceMeters(firstStart, secondStart, secondEnd),
    pointToSegmentDistanceMeters(firstEnd, secondStart, secondEnd),
    pointToSegmentDistanceMeters(secondStart, firstStart, firstEnd),
    pointToSegmentDistanceMeters(secondEnd, firstStart, firstEnd),
  );
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
    // The product policy is conservative: every mapped disruption is a
    // walk-around area. Keep the warning because a roadway/event footprint
    // still does not prove that the sidewalk is physically closed.
    hard.push(feature);
    if (!pedestrianBlocked) {
      warnings.push({
        code: "approximate-obstacle",
        message:
          explicitlyAvoided
            ? "A selected disruption is being treated as a walk-around area, but sidewalk access has not been confirmed."
            : "Mapped disruptions are being treated as walk-around areas, but sidewalk access has not been confirmed.",
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
  const coordinates: AvoidancePolygon["coordinates"] = [];
  for (const feature of features) {
    if (feature.geometry.type === "Point") {
      coordinates.push([
        bufferedPoint(feature.geometry.coordinates as Coordinate, bufferMeters),
      ]);
      continue;
    }
    for (const [start, end] of geometrySegments(feature.geometry)) {
      coordinates.push([bufferedSegment(start, end, bufferMeters)]);
    }
  }
  return {
    type: "MultiPolygon",
    coordinates,
  };
}

function offsetPoint(
  [longitude, latitude]: Coordinate,
  eastMeters: number,
  northMeters: number,
  referenceLatitude: number,
): Coordinate {
  return [
    longitude + eastMeters / longitudeMeters(referenceLatitude),
    latitude + northMeters / METERS_PER_DEGREE,
  ];
}

function bufferedPoint(point: Coordinate, bufferMeters: number) {
  const latitude = point[1];
  const longitudeOffset = bufferMeters / longitudeMeters(latitude);
  const latitudeOffset = bufferMeters / METERS_PER_DEGREE;
  return [
    [point[0] - longitudeOffset, point[1] - latitudeOffset],
    [point[0] + longitudeOffset, point[1] - latitudeOffset],
    [point[0] + longitudeOffset, point[1] + latitudeOffset],
    [point[0] - longitudeOffset, point[1] + latitudeOffset],
    [point[0] - longitudeOffset, point[1] - latitudeOffset],
  ] as Coordinate[];
}

function bufferedSegment(
  start: Coordinate,
  end: Coordinate,
  bufferMeters: number,
) {
  const latitude = (start[1] + end[1]) / 2;
  const east = (end[0] - start[0]) * longitudeMeters(latitude);
  const north = (end[1] - start[1]) * METERS_PER_DEGREE;
  const length = Math.hypot(east, north);
  if (length === 0) return bufferedPoint(start, bufferMeters);
  const eastNormal = (-north / length) * bufferMeters;
  const northNormal = (east / length) * bufferMeters;
  return [
    offsetPoint(start, eastNormal, northNormal, latitude),
    offsetPoint(end, eastNormal, northNormal, latitude),
    offsetPoint(end, -eastNormal, -northNormal, latitude),
    offsetPoint(start, -eastNormal, -northNormal, latitude),
    offsetPoint(start, eastNormal, northNormal, latitude),
  ];
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

export function coordinateInObstacle(
  coordinate: Coordinate,
  obstacle: ClosureFeature,
  bufferMeters = 12,
) {
  const bounds = expandedBounds(obstacle, bufferMeters);
  if (
    coordinate[0] < bounds[0] ||
    coordinate[0] > bounds[2] ||
    coordinate[1] < bounds[1] ||
    coordinate[1] > bounds[3]
  )
    return false;
  if (obstacle.geometry.type === "Point")
    return (
      pointDistanceMeters(
        coordinate,
        obstacle.geometry.coordinates as Coordinate,
      ) <= bufferMeters
    );
  return geometrySegments(obstacle.geometry).some(
    ([start, end]) =>
      pointToSegmentDistanceMeters(coordinate, start, end) <= bufferMeters,
  );
}

export function routeIntersectsObstacles(
  route: RouteFeature,
  obstacles: ClosureFeature[],
  bufferMeters = 12,
  allowOriginExit = false,
) {
  const routeCoordinates = route.geometry.coordinates;
  return obstacles.some((obstacle) => {
    const bounds = expandedBounds(obstacle, bufferMeters);
    for (let index = 1; index < routeCoordinates.length; index += 1) {
      const start = routeCoordinates[index - 1] as Coordinate;
      const end = routeCoordinates[index] as Coordinate;
      const originExit =
        allowOriginExit &&
        index === 1 &&
        coordinateInObstacle(start, obstacle, bufferMeters) &&
        !coordinateInObstacle(end, obstacle, bufferMeters);
      if (originExit) continue;
      const routeWest = Math.min(start[0], end[0]);
      const routeEast = Math.max(start[0], end[0]);
      const routeSouth = Math.min(start[1], end[1]);
      const routeNorth = Math.max(start[1], end[1]);
      if (
        routeEast < bounds[0] ||
        routeWest > bounds[2] ||
        routeNorth < bounds[1] ||
        routeSouth > bounds[3]
      )
        continue;
      if (obstacle.geometry.type === "Point") {
        if (
          pointToSegmentDistanceMeters(
            obstacle.geometry.coordinates as Coordinate,
            start,
            end,
          ) <= bufferMeters
        )
          return true;
        continue;
      }
      if (
        geometrySegments(obstacle.geometry).some(
          ([obstacleStart, obstacleEnd]) =>
            segmentsDistanceMeters(
              start,
              end,
              obstacleStart,
              obstacleEnd,
            ) <= bufferMeters,
        )
      )
        return true;
    }
    return false;
  });
}
