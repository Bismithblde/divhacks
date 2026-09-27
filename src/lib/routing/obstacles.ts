import { geometryBounds } from "@/lib/closures/normalize";
import type { ClosureFeature, ClosureGeometry } from "@/lib/closures/types";
import type { EventAccessOverride } from "@/lib/events/types";
import type {
  AvoidancePolygon,
  ClassifiedObstacles,
  Coordinate,
  RouteFeature,
  RouteMode,
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
  mode: RouteMode = "foot-walking",
  accessOverrides: Array<{
    closureId: string;
    access: EventAccessOverride;
  }> = [],
): ClassifiedObstacles {
  const requested = new Set(avoidClosureIds);
  const overrides = new Map(
    accessOverrides.map((override) => [override.closureId, override.access]),
  );
  const hard: ClosureFeature[] = [];
  const warnings: RouteWarning[] = [];

  for (const feature of features) {
    const override = overrides.get(feature.properties.id);
    if (override) {
      const blocked =
        (mode === "driving-car" && override === "roads-closed") ||
        (mode === "foot-walking" && override === "sidewalk-closed");
      warnings.push({
        code: "user-access-override",
        message: blocked
          ? `This route treats ${feature.properties.title} as blocked based on your session-only access setting.`
          : `This route may pass through ${feature.properties.title} based on your session-only access setting.`,
        closureIds: [feature.properties.id],
      });
      if (blocked) hard.push(feature);
      continue;
    }
    const explicitlyAvoided = requested.has(feature.properties.id);
    const vehicleAccessClear =
      mode === "driving-car" &&
      feature.properties.vehicleImpact === "clear";
    const confirmedImpact =
      mode === "foot-walking" &&
      feature.properties.pedestrianImpact === "blocked";
    if (vehicleAccessClear) continue;
    // The product policy is conservative: every mapped disruption is a
    // mode-specific avoidance area. Keep the warning because a scheduled
    // footprint does not prove current access for the selected travel mode.
    hard.push(feature);
    if (!confirmedImpact) {
      warnings.push({
        code: "approximate-obstacle",
        message:
          mode === "driving-car"
            ? explicitlyAvoided
              ? "A selected disruption is being treated as a road obstacle, but current vehicle access has not been confirmed."
              : "Mapped disruptions are being treated as road obstacles, but current vehicle access has not been confirmed."
            : explicitlyAvoided
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

export function nearestOpenPoint(
  coordinate: Coordinate,
  obstacles: ClosureFeature[],
): Coordinate | null {
  const blocked = (point: Coordinate) =>
    obstacles.some((obstacle) => coordinateInObstacle(point, obstacle));
  if (!blocked(coordinate)) return coordinate;
  for (const meters of [35, 60, 90]) {
    for (let step = 0; step < 8; step += 1) {
      const radians = (step / 8) * Math.PI * 2;
      const candidate: Coordinate = [
        coordinate[0] +
          (Math.cos(radians) * meters) / longitudeMeters(coordinate[1]),
        coordinate[1] + (Math.sin(radians) * meters) / METERS_PER_DEGREE,
      ];
      if (!blocked(candidate)) return candidate;
    }
  }
  return null;
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

function segmentNearRoute(
  start: Coordinate,
  end: Coordinate,
  route: RouteFeature,
  maxDistanceMeters: number,
) {
  const coordinates = route.geometry.coordinates;
  for (let index = 1; index < coordinates.length; index += 1) {
    if (
      segmentsDistanceMeters(
        start,
        end,
        coordinates[index - 1] as Coordinate,
        coordinates[index] as Coordinate,
      ) <= maxDistanceMeters
    ) {
      return true;
    }
  }
  return false;
}

function routeIntersectsObstacle(
  route: RouteFeature,
  obstacle: ClosureFeature,
  bufferMeters = 12,
  allowOriginExit = false,
) {
  const routeCoordinates = route.geometry.coordinates;
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
}

// Keep only the closed segments the current walk would actually meet, so a
// long permit does not become a city-sized avoid area.
export function clipObstacleToRoute(
  obstacle: ClosureFeature,
  route: RouteFeature,
  maxDistanceMeters = 40,
  keepAwayFrom: Coordinate[] = [],
): ClosureFeature | null {
  const clearOfEnds = (start: Coordinate, end: Coordinate) =>
    keepAwayFrom.every(
      (point) => pointToSegmentDistanceMeters(point, start, end) > 30,
    );
  if (obstacle.geometry.type === "Point") {
    const point = obstacle.geometry.coordinates as Coordinate;
    return segmentNearRoute(point, point, route, maxDistanceMeters) &&
      clearOfEnds(point, point)
      ? obstacle
      : null;
  }
  const kept = geometrySegments(obstacle.geometry).filter(
    ([start, end]) =>
      segmentNearRoute(start, end, route, maxDistanceMeters) &&
      clearOfEnds(start, end),
  );
  if (!kept.length) return null;
  return {
    ...obstacle,
    geometry: {
      type: "MultiLineString",
      coordinates: kept.map(([start, end]) => [start, end]),
    },
  };
}

export function obstaclesIntersectedByRoute(
  route: RouteFeature,
  obstacles: ClosureFeature[],
  bufferMeters = 12,
  allowOriginExit = false,
) {
  return obstacles.filter((obstacle) =>
    routeIntersectsObstacle(route, obstacle, bufferMeters, allowOriginExit),
  );
}

export function routeIntersectsObstacles(
  route: RouteFeature,
  obstacles: ClosureFeature[],
  bufferMeters = 12,
  allowOriginExit = false,
) {
  return (
    obstaclesIntersectedByRoute(
      route,
      obstacles,
      bufferMeters,
      allowOriginExit,
    ).length > 0
  );
}
