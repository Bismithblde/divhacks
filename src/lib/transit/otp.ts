import polyline from "@mapbox/polyline";
import type {
  Coordinate,
  FeedFreshness,
  LegMode,
  TransitItinerary,
  TransitPlanInput,
  TransitRouter,
  TripAlert,
  TripLeg,
} from "@/lib/trips/types";
import { routeStepsForLeg } from "@/lib/trips/steps";

const OTP_QUERY = `
query Plan($originLat: CoordinateValue!, $originLon: CoordinateValue!, $destinationLat: CoordinateValue!, $destinationLon: CoordinateValue!, $dateTime: PlanDateTimeInput!) {
  planConnection(
    origin: { location: { coordinate: { latitude: $originLat, longitude: $originLon } } }
    destination: { location: { coordinate: { latitude: $destinationLat, longitude: $destinationLon } } }
    dateTime: $dateTime
    modes: {
      direct: [WALK]
      transit: { transit: [{ mode: SUBWAY }, { mode: BUS }] }
    }
    first: 5
  ) {
    routingErrors { code description }
    edges {
      node {
        startTime: start
        endTime: end
        legs {
          mode
          start {
            scheduledTime
            estimated { time delay }
          }
          end {
            scheduledTime
            estimated { time delay }
          }
          duration
          distance
          realTime
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          route { shortName longName color }
          alerts { alertDescriptionText }
          legGeometry { points }
        }
      }
    }
  }
}
`;

type OtpResponse = {
  data?: {
    planConnection?: {
      routingErrors?: Array<{ code?: string; description?: string }>;
      edges?: Array<{ node?: OtpItinerary }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

type OtpItinerary = {
  startTime?: string | number;
  endTime?: string | number;
  legs?: OtpLeg[];
};

type OtpLeg = {
  mode?: string;
  startTime?: string | number;
  endTime?: string | number;
  start?: OtpLegTime;
  end?: OtpLegTime;
  duration?: number;
  distance?: number;
  realTime?: boolean;
  from?: OtpPlace;
  to?: OtpPlace;
  route?: {
    shortName?: string;
    longName?: string;
    color?: string;
  };
  alerts?: Array<{
    alertDescription?: string;
    alertDescriptionText?: string;
  }>;
  legGeometry?: { points?: string };
};

type OtpPlace = {
  name?: string;
  lat?: number;
  lon?: number;
  gtfsId?: string;
  stop?: { gtfsId?: string };
};

type OtpLegTime = {
  scheduledTime?: string;
  estimated?: {
    time?: string;
    delay?: number;
  };
};

function legTime(value: OtpLegTime | undefined, fallback?: string | number) {
  return value?.estimated?.time || value?.scheduledTime || fallback;
}

function timestamp(value: string | number | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function point(place: OtpPlace | undefined, fallback: Coordinate): Coordinate {
  return typeof place?.lon === "number" && typeof place.lat === "number"
    ? [place.lon, place.lat]
    : fallback;
}

function legMode(value: string | undefined): LegMode {
  if (value === "BUS") return "BUS";
  if (value === "SUBWAY" || value === "TRAM" || value === "RAIL")
    return "SUBWAY";
  return "WALK";
}

function geometry(points: string | undefined) {
  if (!points) return undefined;
  try {
    const decoded = polyline.decode(points);
    return {
      type: "LineString" as const,
      coordinates: decoded.map(([latitude, longitude]) => [
        longitude,
        latitude,
      ]) as Coordinate[],
    };
  } catch {
    return undefined;
  }
}

function normalizeLeg(
  leg: OtpLeg,
  index: number,
  origin: Coordinate,
  destination: Coordinate,
): TripLeg | null {
  const start = timestamp(legTime(leg.start, leg.startTime));
  const end = timestamp(legTime(leg.end, leg.endTime));
  if (start === null || end === null || end <= start) return null;
  const mode = legMode(leg.mode);
  const from = point(leg.from, index === 0 ? origin : destination);
  const to = point(leg.to, index === 0 ? destination : origin);
  const alert = leg.alerts
    ?.map((item) => item.alertDescriptionText || item.alertDescription)
    .find((value): value is string => Boolean(value));
  const delaySeconds =
    leg.end?.estimated?.delay ?? leg.start?.estimated?.delay;
  const normalized: TripLeg = {
    id: `otp-leg-${index}`,
    mode,
    from: {
      name: leg.from?.name || (index === 0 ? "Origin" : "Transfer"),
      coordinate: from,
    },
    to: {
      name: leg.to?.name || (index === 0 ? "Destination" : "Transfer"),
      coordinate: to,
    },
    fromStopId: leg.from?.gtfsId || leg.from?.stop?.gtfsId,
    toStopId: leg.to?.gtfsId || leg.to?.stop?.gtfsId,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationSeconds: Math.round(leg.duration || (end - start) / 1000),
    distanceMeters: leg.distance,
    geometry: geometry(leg.legGeometry?.points),
    routeName:
      mode === "WALK"
        ? undefined
        : leg.route?.shortName || leg.route?.longName || mode,
    routeColor: leg.route?.color,
    status: leg.realTime || leg.start?.estimated || leg.end?.estimated
      ? "realtime"
      : "scheduled",
    delaySeconds,
    alert,
    realtimeSource: leg.realTime ? "MTA GTFS-Realtime via OTP" : undefined,
  };
  return {
    ...normalized,
    steps: routeStepsForLeg(normalized),
  };
}

function normalizeItinerary(
  itinerary: OtpItinerary,
  index: number,
  input: TransitPlanInput,
): TransitItinerary | null {
  const legs = (itinerary.legs || [])
    .map((leg, legIndex) =>
      normalizeLeg(leg, legIndex, input.origin, input.destination),
    )
    .filter((leg): leg is TripLeg => Boolean(leg));
  if (!legs.length) return null;
  const start = timestamp(itinerary.startTime) ?? Date.parse(legs[0].startTime);
  const end =
    timestamp(itinerary.endTime) ?? Date.parse(legs[legs.length - 1].endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  const alerts: TripAlert[] = legs
    .filter((leg) => leg.alert)
    .map((leg, alertIndex) => ({
      id: `otp-alert-${index}-${alertIndex}`,
      severity: "warning" as const,
      message: leg.alert!,
      source: "MTA via OpenTripPlanner",
      updatedAt: null,
    }));
  return {
    id: `otp-itinerary-${index}`,
    legs,
    departureTime: new Date(start).toISOString(),
    arrivalTime: new Date(end).toISOString(),
    durationSeconds: Math.round((end - start) / 1000),
    transfers: Math.max(
      0,
      legs.filter((leg) => leg.mode !== "WALK").length - 1,
    ),
    walkingSeconds: legs
      .filter((leg) => leg.mode === "WALK")
      .reduce((total, leg) => total + leg.durationSeconds, 0),
    waitingSeconds: Math.max(
      0,
      Math.round(
        (start - Date.parse(input.timing.type === "depart-at"
          ? input.timing.time
          : new Date().toISOString())) /
          1000,
      ),
    ),
    status: legs.some((leg) => leg.status === "realtime")
      ? "realtime"
      : "scheduled",
    alerts,
    provider: "open-trip-planner",
    sourceFetchedAt: new Date().toISOString(),
  };
}

export class OtpProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "unavailable" | "invalid" = "unavailable",
  ) {
    super(message);
  }
}

export class OpenTripPlannerRouter implements TransitRouter {
  async plan(input: TransitPlanInput): Promise<TransitItinerary[]> {
    const baseUrl = process.env.OTP_BASE_URL;
    if (!baseUrl) {
      throw new OtpProviderError(
        "Transit planning is not configured. Add OTP_BASE_URL to the server.",
      );
    }
    const dateTime =
      input.timing.type === "arrive-by"
        ? { latestArrival: input.timing.time }
        : {
            earliestDeparture:
              input.timing.type === "depart-at"
                ? input.timing.time
                : new Date().toISOString(),
          };
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/otp/routers/default/index/graphql`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: OTP_QUERY,
            variables: {
              originLat: input.origin[1],
              originLon: input.origin[0],
              destinationLat: input.destination[1],
              destinationLon: input.destination[0],
              dateTime,
            },
          }),
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        },
      );
    } catch {
      throw new OtpProviderError("OpenTripPlanner could not be reached.");
    }
    if (!response.ok)
      throw new OtpProviderError(
        `OpenTripPlanner returned HTTP ${response.status}.`,
      );
    let body: OtpResponse;
    try {
      body = (await response.json()) as OtpResponse;
    } catch {
      throw new OtpProviderError("OpenTripPlanner returned invalid JSON.", "invalid");
    }
    if (body.errors?.length)
      throw new OtpProviderError(
        body.errors.map((error) => error.message).filter(Boolean).join("; ") ||
          "OpenTripPlanner returned an error.",
      );
    const itineraries = (body.data?.planConnection?.edges || [])
      .map((edge, index) =>
        edge.node ? normalizeItinerary(edge.node, index, input) : null,
      )
      .filter((value): value is TransitItinerary => Boolean(value));
    if (!process.env.MTA_BUS_TIME_API_KEY) return itineraries;
    const busClient = new MtaBusTimeClient();
    return Promise.all(
      itineraries.map(async (itinerary) => {
        const busLegs = itinerary.legs.filter(
          (leg) => leg.mode === "BUS" && leg.fromStopId,
        );
        if (!busLegs.length) return itinerary;
        const results = await Promise.all(
          busLegs.map((leg) =>
            busClient.stopPredictions(leg.fromStopId!, leg.routeName),
          ),
        );
        const liveByLeg = new Map(
          busLegs.map((leg, index) => {
            const result = results[index];
            return [
              `${leg.fromStopId}:${leg.routeName || ""}`,
              result?.status === "live" && result.predictions.length
                ? result.predictions[0]
                : null,
            ] as const;
          }),
        );
        if (![...liveByLeg.values()].some(Boolean)) return itinerary;
        const updatedLegs = itinerary.legs.map((leg) => {
          if (leg.mode !== "BUS" || !leg.fromStopId) return leg;
          const next =
            liveByLeg.get(`${leg.fromStopId}:${leg.routeName || ""}`) ||
            null;
          if (!next) return leg;
          const delaySeconds = Math.round(
            (Date.parse(next.expectedArrival) - Date.parse(leg.startTime)) /
              1000,
          );
          return {
            ...leg,
            status: "realtime" as const,
            delaySeconds,
            realtimeSource: "MTA Bus Time",
          };
        });
        return {
          ...itinerary,
          legs: updatedLegs,
          status: "realtime" as const,
          sourceFetchedAt:
            results.find((result) => result.status === "live")?.freshness
              .fetchedAt || itinerary.sourceFetchedAt,
        };
      }),
    );
  }
}

type BusPrediction = {
  routeName: string;
  expectedArrival: string;
  vehicleId?: string;
  stopsAway?: number;
};

export type BusRealtimeResult = {
  status: "live" | "unavailable";
  predictions: BusPrediction[];
  freshness: FeedFreshness;
  message?: string;
};

export class MtaBusTimeClient {
  async stopPredictions(
    stopId: string,
    routeName?: string,
  ): Promise<BusRealtimeResult> {
    const key = process.env.MTA_BUS_TIME_API_KEY;
    const fetchedAt = new Date().toISOString();
    if (!key) {
      return {
        status: "unavailable",
        predictions: [],
        freshness: {
          id: "mta-bus-time",
          label: "MTA Bus Time",
          status: "scheduled",
          fetchedAt: null,
          updatedAt: null,
          message: "Bus realtime is not configured; using scheduled service.",
        },
        message: "MTA_BUS_TIME_API_KEY is not configured.",
      };
    }
    const monitoringRef = stopId.replace(/^MTA[_:]/i, "");
    const params = new URLSearchParams({
      key,
      version: "2",
      OperatorRef: "MTA",
      MonitoringRef: monitoringRef,
      StopMonitoringDetailLevel: "minimum",
    });
    if (routeName) params.set("LineRef", `MTA NYCT_${routeName}`);
    try {
      const response = await fetch(
        `https://bustime.mta.info/api/siri/stop-monitoring.json?${params}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as {
        Siri?: {
          ServiceDelivery?: {
            StopMonitoringDelivery?: Array<{
              MonitoredStopVisit?: Array<{
                MonitoredVehicleJourney?: {
                  PublishedLineName?: string;
                  VehicleRef?: string;
                  MonitoredCall?: {
                    ExpectedArrivalTime?: string;
                    Extensions?: { Distances?: { StopsFromCall?: number } };
                  };
                };
              }>;
            }>;
          };
        };
      };
      const visits =
        body.Siri?.ServiceDelivery?.StopMonitoringDelivery?.flatMap(
          (delivery) => delivery.MonitoredStopVisit || [],
        ) || [];
      const predictions = visits
        .map((visit) => visit.MonitoredVehicleJourney)
        .filter(
          (
            journey,
          ): journey is NonNullable<
            NonNullable<
              NonNullable<
                NonNullable<
                  typeof visits[number]["MonitoredVehicleJourney"]
                >
              >
            >
          > => Boolean(journey?.MonitoredCall?.ExpectedArrivalTime),
        )
        .map((journey) => ({
          routeName: journey.PublishedLineName || routeName || "Bus",
          expectedArrival: journey.MonitoredCall!.ExpectedArrivalTime!,
          vehicleId: journey.VehicleRef,
          stopsAway: journey.MonitoredCall?.Extensions?.Distances?.StopsFromCall,
        }));
      return {
        status: "live",
        predictions,
        freshness: {
          id: "mta-bus-time",
          label: "MTA Bus Time",
          status: "live",
          fetchedAt,
          updatedAt: fetchedAt,
        },
      };
    } catch {
      return {
        status: "unavailable",
        predictions: [],
        freshness: {
          id: "mta-bus-time",
          label: "MTA Bus Time",
          status: "unavailable",
          fetchedAt,
          updatedAt: null,
          message: "The live bus feed could not be reached.",
        },
        message: "MTA Bus Time is unavailable; using scheduled service.",
      };
    }
  }
}

