import type { ClosureGeometry } from "./types";

type Coordinate = [number, number];

const CENTERLINE_URL =
  "https://data.cityofnewyork.us/resource/g6zj-tzgn.json";
const CENTERLINE_CACHE_TTL = 6 * 60 * 60_000;
const MATCH_TOLERANCE_METERS = 45;
const CLIP_MARGIN_METERS = 35;
const QUERY_BATCH_SIZE = 60;

type CenterlineRow = {
  street_nm?: unknown;
  borough?: unknown;
  the_geom?: unknown;
};

type CenterlineRecord = {
  streetName: string;
  borough: string;
  geometry: ClosureGeometry;
};

type ParsedLocation = {
  street: string;
  from: string;
  to: string;
};

type EventLocation = {
  location: string;
  borough: string;
};

const STREET_WORDS: Record<string, string> = {
  AVE: "AVENUE",
  BLVD: "BOULEVARD",
  CTR: "CENTER",
  CIR: "CIRCLE",
  CT: "COURT",
  DR: "DRIVE",
  EXPY: "EXPRESSWAY",
  FT: "FORT",
  HWY: "HIGHWAY",
  JCT: "JUNCTION",
  LN: "LANE",
  MT: "MOUNT",
  PKWY: "PARKWAY",
  PL: "PLACE",
  RD: "ROAD",
  SQ: "SQUARE",
  ST: "STREET",
  TER: "TERRACE",
  TPKE: "TURNPIKE",
  TUNL: "TUNNEL",
  WAY: "WAY",
};

const lineCache = new Map<
  string,
  { fetchedAt: number; records: CenterlineRecord[] }
>();

function text(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function coordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function lineParts(value: unknown): Coordinate[][] {
  if (!value || typeof value !== "object") return [];
  const geometry = value as {
    type?: unknown;
    coordinates?: unknown;
  };
  if (
    geometry.type === "LineString" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.every(coordinate)
  ) {
    return [geometry.coordinates as Coordinate[]];
  }
  if (
    geometry.type === "MultiLineString" &&
    Array.isArray(geometry.coordinates)
  ) {
    return geometry.coordinates.filter(
      (line): line is Coordinate[] =>
        Array.isArray(line) && line.length >= 2 && line.every(coordinate),
    );
  }
  return [];
}

function geometry(value: unknown): ClosureGeometry | null {
  const parts = lineParts(value);
  return parts.length
    ? { type: "MultiLineString", coordinates: parts }
    : null;
}

function canonicalStreetName(value: string) {
  return text(value)
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(\d+)(?:ST|ND|RD|TH)\b/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_WORDS[word] || word)
    .map((word) => {
      if (word === "E") return "EAST";
      if (word === "W") return "WEST";
      if (word === "N") return "NORTH";
      if (word === "S") return "SOUTH";
      return word;
    })
    .join(" ");
}

function streetNameVariants(value: string) {
  const cleaned = text(value)
    .replace(/\([^)]*\)/g, " ")
    .split(":")
    .pop()
    ?.trim();
  if (!cleaned) return [];
  const words = cleaned.split(/\s+/);
  const candidates = new Set<string>([cleaned]);
  for (let length = 1; length <= Math.min(6, words.length); length += 1) {
    candidates.add(words.slice(-length).join(" "));
  }
  return [...candidates].flatMap((candidate) => {
    const upper = candidate.toUpperCase().replace(/[.,]/g, " ");
    const expanded = upper
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => STREET_WORDS[word] || word)
      .join(" ");
    return [...new Set([upper, expanded])];
  });
}

function locationParts(location: string): ParsedLocation[] {
  const parts = text(location).split(
    /\s*,\s*(?=[^,]+\s+between\s+)/i,
  );
  return parts.flatMap((part) => {
    const between = /\s+between\s+/i.exec(part);
    if (!between || between.index === undefined) return [];
    const street = part.slice(0, between.index).trim();
    const crossStreets = part.slice(
      between.index + between[0].length,
    );
    const separator = crossStreets.toLowerCase().lastIndexOf(" and ");
    if (!street || separator < 0) return [];
    const from = crossStreets.slice(0, separator).trim();
    const to = crossStreets.slice(separator + 5).trim();
    return from && to ? [{ street, from, to }] : [];
  });
}

export function parseEventLocation(location: string) {
  return locationParts(location);
}

async function readJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Centerline feed returned ${response.status}`);
  return (await response.json()) as unknown;
}

function escapeSoql(value: string) {
  return value.replace(/'/g, "''");
}

async function fetchCenterlineRows(names: string[]) {
  const where = `upper(street_nm) in (${names
    .map((name) => `'${escapeSoql(name)}'`)
    .join(",")})`;
  const params = new URLSearchParams({
    $select: "street_nm,borough,the_geom",
    $where: where,
    $limit: "50000",
  });
  const data = await readJson(`${CENTERLINE_URL}?${params}`);
  return Array.isArray(data) ? (data as CenterlineRow[]) : [];
}

async function centerlineIndex(names: string[]) {
  const requested = new Map<string, Set<string>>();
  for (const name of names) {
    for (const variant of streetNameVariants(name)) {
      const key = canonicalStreetName(variant);
      if (!key) continue;
      const variants = requested.get(key) || new Set<string>();
      variants.add(variant);
      requested.set(key, variants);
    }
  }
  const missing = [...requested].filter(
    ([key]) =>
      !lineCache.has(key) ||
      Date.now() - lineCache.get(key)!.fetchedAt >= CENTERLINE_CACHE_TTL,
  );
  if (missing.length) {
    const queryNames = [
      ...new Set(missing.flatMap(([, variants]) => [...variants])),
    ];
    const rows: CenterlineRecord[] = [];
    for (let offset = 0; offset < queryNames.length; offset += QUERY_BATCH_SIZE * 3) {
      const pages = await Promise.all(
        [0, 1, 2].map(async (batch) => {
          const namesForPage = queryNames.slice(
            offset + batch * QUERY_BATCH_SIZE,
            offset + (batch + 1) * QUERY_BATCH_SIZE,
          );
          return namesForPage.length
            ? fetchCenterlineRows(namesForPage)
            : [];
        }),
      );
      for (const page of pages) {
        for (const row of page) {
          const streetName = text(row.street_nm);
          const rowGeometry = geometry(row.the_geom);
          if (!streetName || !rowGeometry) continue;
          rows.push({
            streetName,
            borough: text(row.borough),
            geometry: rowGeometry,
          });
        }
      }
    }
    const byKey = new Map<string, CenterlineRecord[]>();
    for (const row of rows) {
      const key = canonicalStreetName(row.streetName);
      const records = byKey.get(key) || [];
      records.push(row);
      byKey.set(key, records);
    }
    const fetchedAt = Date.now();
    for (const [key] of missing) {
      lineCache.set(key, {
        fetchedAt,
        records: byKey.get(key) || [],
      });
    }
  }
  return new Map(
    [...requested].map(([key]) => [key, lineCache.get(key)?.records || []]),
  );
}

function recordsFor(
  index: Map<string, CenterlineRecord[]>,
  value: string,
  borough: string,
) {
  const records = streetNameVariants(value).flatMap(
    (variant) => index.get(canonicalStreetName(variant)) || [],
  );
  const unique = [
    ...new Map(
      records.map((record) => [
        `${record.streetName}|${record.borough}|${JSON.stringify(record.geometry)}`,
        record,
      ]),
    ).values(),
  ];
  const boroughKey = text(borough).toUpperCase();
  return unique.filter(
    (record) =>
      !boroughKey || !record.borough || record.borough.toUpperCase() === boroughKey,
  );
}

function longitudeMeters(latitude: number) {
  return 111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
}

function pointDistanceMeters(a: Coordinate, b: Coordinate) {
  const latitude = (a[1] + b[1]) / 2;
  return Math.hypot(
    (a[0] - b[0]) * longitudeMeters(latitude),
    (a[1] - b[1]) * 111_320,
  );
}

function pointToSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
) {
  const latitude = (point[1] + start[1] + end[1]) / 3;
  const scaleX = longitudeMeters(latitude);
  const scaleY = 111_320;
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
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
        );
  const projected: Coordinate = [
    (ax + t * dx) / scaleX,
    (ay + t * dy) / scaleY,
  ];
  return {
    distance: pointDistanceMeters(point, projected),
    point: projected,
  };
}

function orientation(a: Coordinate, b: Coordinate, c: Coordinate) {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Coordinate, b: Coordinate, c: Coordinate) {
  return (
    c[0] >= Math.min(a[0], b[0]) - 1e-10 &&
    c[0] <= Math.max(a[0], b[0]) + 1e-10 &&
    c[1] >= Math.min(a[1], b[1]) - 1e-10 &&
    c[1] <= Math.max(a[1], b[1]) + 1e-10
  );
}

function intersection(
  firstStart: Coordinate,
  firstEnd: Coordinate,
  secondStart: Coordinate,
  secondEnd: Coordinate,
) {
  const firstOrientation = orientation(
    firstStart,
    firstEnd,
    secondStart,
  );
  const secondOrientation = orientation(
    firstStart,
    firstEnd,
    secondEnd,
  );
  const thirdOrientation = orientation(
    secondStart,
    secondEnd,
    firstStart,
  );
  const fourthOrientation = orientation(
    secondStart,
    secondEnd,
    firstEnd,
  );
  const intersects =
    (firstOrientation === 0 && onSegment(firstStart, firstEnd, secondStart)) ||
    (secondOrientation === 0 && onSegment(firstStart, firstEnd, secondEnd)) ||
    (thirdOrientation === 0 && onSegment(secondStart, secondEnd, firstStart)) ||
    (fourthOrientation === 0 && onSegment(secondStart, secondEnd, firstEnd)) ||
    ((firstOrientation > 0) !== (secondOrientation > 0) &&
      (thirdOrientation > 0) !== (fourthOrientation > 0));
  if (!intersects) return null;
  const denominator =
    (firstStart[0] - firstEnd[0]) * (secondStart[1] - secondEnd[1]) -
    (firstStart[1] - firstEnd[1]) * (secondStart[0] - secondEnd[0]);
  if (Math.abs(denominator) < 1e-12) return firstStart;
  const firstCross =
    firstStart[0] * firstEnd[1] - firstStart[1] * firstEnd[0];
  const secondCross =
    secondStart[0] * secondEnd[1] - secondStart[1] * secondEnd[0];
  return [
    (firstCross * (secondStart[0] - secondEnd[0]) -
      (firstStart[0] - firstEnd[0]) * secondCross) /
      denominator,
    (firstCross * (secondStart[1] - secondEnd[1]) -
      (firstStart[1] - firstEnd[1]) * secondCross) /
      denominator,
  ] as Coordinate;
}

function nearestPointBetweenLines(
  first: Coordinate[],
  second: Coordinate[],
) {
  let best: { distance: number; point: Coordinate } | null = null;
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex - 1];
    const firstEnd = first[firstIndex];
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      const secondStart = second[secondIndex - 1];
      const secondEnd = second[secondIndex];
      const crossing = intersection(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      );
      if (crossing) return { distance: 0, point: crossing };
      const candidates = [
        {
          distance: pointToSegment(firstStart, secondStart, secondEnd).distance,
          point: firstStart,
        },
        {
          distance: pointToSegment(firstEnd, secondStart, secondEnd).distance,
          point: firstEnd,
        },
        pointToSegment(secondStart, firstStart, firstEnd),
        pointToSegment(secondEnd, firstStart, firstEnd),
      ];
      const candidate = candidates.reduce((current, next) =>
        next.distance < current.distance ? next : current,
      );
      if (!best || candidate.distance < best.distance) best = candidate;
    }
  }
  return best;
}

function nearestCrossing(
  first: Coordinate[][],
  second: Coordinate[][],
) {
  let best: { distance: number; point: Coordinate } | null = null;
  for (const firstLine of first) {
    for (const secondLine of second) {
      const candidate = nearestPointBetweenLines(firstLine, secondLine);
      if (candidate && (!best || candidate.distance < best.distance))
        best = candidate;
    }
  }
  return best;
}

function clipSegment(
  start: Coordinate,
  end: Coordinate,
  bounds: [number, number, number, number],
) {
  const [minX, minY, maxX, maxY] = bounds;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let lower = 0;
  let upper = 1;
  const checks = [
    [-dx, start[0] - minX],
    [dx, maxX - start[0]],
    [-dy, start[1] - minY],
    [dy, maxY - start[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return null;
  }
  const clippedStart: Coordinate = [
    start[0] + lower * dx,
    start[1] + lower * dy,
  ];
  const clippedEnd: Coordinate = [
    start[0] + upper * dx,
    start[1] + upper * dy,
  ];
  return pointDistanceMeters(clippedStart, clippedEnd) > 0
    ? [clippedStart, clippedEnd]
    : null;
}

function resolveSegment(
  segment: ParsedLocation,
  index: Map<string, CenterlineRecord[]>,
  borough: string,
) {
  const onStreet = recordsFor(index, segment.street, borough).flatMap((row) =>
    lineParts(row.geometry),
  );
  const fromStreet = recordsFor(index, segment.from, borough).flatMap((row) =>
    lineParts(row.geometry),
  );
  const toStreet = recordsFor(index, segment.to, borough).flatMap((row) =>
    lineParts(row.geometry),
  );
  if (!onStreet.length || !fromStreet.length || !toStreet.length) return null;
  const from = nearestCrossing(onStreet, fromStreet);
  const to = nearestCrossing(onStreet, toStreet);
  if (
    !from ||
    !to ||
    from.distance > MATCH_TOLERANCE_METERS ||
    to.distance > MATCH_TOLERANCE_METERS
  )
    return null;
  const latitude = (from.point[1] + to.point[1]) / 2;
  const marginLatitude = CLIP_MARGIN_METERS / 111_320;
  const marginLongitude = CLIP_MARGIN_METERS / longitudeMeters(latitude);
  const bounds: [number, number, number, number] = [
    Math.min(from.point[0], to.point[0]) - marginLongitude,
    Math.min(from.point[1], to.point[1]) - marginLatitude,
    Math.max(from.point[0], to.point[0]) + marginLongitude,
    Math.max(from.point[1], to.point[1]) + marginLatitude,
  ];
  const clipped: Coordinate[][] = [];
  for (const line of onStreet) {
    for (let index = 1; index < line.length; index += 1) {
      const piece = clipSegment(line[index - 1], line[index], bounds);
      if (piece) clipped.push(piece);
    }
  }
  return clipped.length
    ? { type: "MultiLineString" as const, coordinates: clipped }
    : null;
}

export async function resolveEventLocations(events: EventLocation[]) {
  const parsed = events.map((event) => locationParts(event.location));
  const names = parsed.flatMap((parts) =>
    parts.flatMap((part) => [part.street, part.from, part.to]),
  );
  const index = await centerlineIndex(names);
  return parsed.map((parts, eventIndex) => {
    const geometries = parts
      .map((part) =>
        resolveSegment(part, index, events[eventIndex].borough),
      )
      .filter(
        (
          value,
        ): value is {
          type: "MultiLineString";
          coordinates: Coordinate[][];
        } => value !== null,
      );
    const coordinates = geometries.flatMap((value) => value.coordinates);
    return coordinates.length
      ? ({ type: "MultiLineString", coordinates } satisfies ClosureGeometry)
      : null;
  });
}
