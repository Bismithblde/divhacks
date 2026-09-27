import type {
  ActiveTripStatus,
  RouteOption,
  TripLeg,
} from "./types";

export const MISSED_DEPARTURE_GRACE_SECONDS = 90;

export function currentLegIndex(
  route: Pick<RouteOption, "legs">,
  now = Date.now(),
): number {
  const index = route.legs.findIndex(
    (leg) => Date.parse(leg.endTime) > now,
  );
  return index >= 0 ? index : Math.max(0, route.legs.length - 1);
}

export function statusForLeg(
  leg: TripLeg,
  now = Date.now(),
): ActiveTripStatus {
  if (Date.parse(leg.startTime) > now) return "waiting";
  if (Date.parse(leg.endTime) <= now) return "transfer";
  if (leg.mode === "WALK") return "walking-to-stop";
  return "riding";
}

export function statusForTrip(
  route: RouteOption,
  legIndex: number,
  now = Date.now(),
): ActiveTripStatus {
  const finalLeg = route.legs[route.legs.length - 1];
  if (finalLeg && Date.parse(finalLeg.endTime) <= now) return "arrived";
  const leg = route.legs[legIndex] || route.legs[0];
  return leg ? statusForLeg(leg, now) : "ready";
}

export function missedTransitDeparture(
  leg: TripLeg,
  now = Date.now(),
): boolean {
  return (
    (leg.mode === "BUS" || leg.mode === "SUBWAY") &&
    Date.parse(leg.startTime) + MISSED_DEPARTURE_GRACE_SECONDS * 1000 < now &&
    Date.parse(leg.endTime) > now
  );
}

export function sameService(
  left: RouteOption | undefined,
  right: RouteOption | undefined,
): boolean {
  if (!left || !right) return false;
  const leftRoutes = left.legs
    .filter((leg) => leg.mode === "BUS" || leg.mode === "SUBWAY")
    .map((leg) => leg.routeName)
    .filter(Boolean);
  const rightRoutes = right.legs
    .filter((leg) => leg.mode === "BUS" || leg.mode === "SUBWAY")
    .map((leg) => leg.routeName)
    .filter(Boolean);
  return leftRoutes.length > 0 && leftRoutes.some((route) => rightRoutes.includes(route));
}
