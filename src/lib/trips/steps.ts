import type {
  RouteOption,
  RouteStep,
  ScoredItinerary,
  TripLeg,
  TransitItinerary,
} from "./types";

function zeroStepTime(value: string) {
  return {
    startTime: value,
    endTime: value,
    durationSeconds: 0,
  };
}

export function routeStepsForLeg(leg: TripLeg): RouteStep[] {
  if (leg.mode === "WALK") {
    const coordinates = leg.geometry?.coordinates;
    if (leg.instructions?.length && coordinates?.length) {
      let elapsedSeconds = 0;
      return leg.instructions.map((instruction, index) => {
        const startIndex = Math.max(
          0,
          Math.min(
            coordinates.length - 1,
            instruction.wayPoints?.[0] ?? (index === 0 ? 0 : index),
          ),
        );
        const endIndex = Math.max(
          startIndex,
          Math.min(
            coordinates.length - 1,
            instruction.wayPoints?.[1] ?? startIndex + 1,
          ),
        );
        const startTime = new Date(
          Date.parse(leg.startTime) + elapsedSeconds * 1000,
        ).toISOString();
        elapsedSeconds += instruction.durationSeconds;
        const endTime = new Date(
          Date.parse(leg.startTime) + elapsedSeconds * 1000,
        ).toISOString();
        return {
          id: `${leg.id}-walk-${index}`,
          kind: "walk" as const,
          mode: leg.mode,
          instruction: instruction.instruction,
          from: {
            name: index === 0 ? leg.from.name : "Continue walking",
            coordinate: coordinates[startIndex] as [number, number],
          },
          to: {
            name:
              index === leg.instructions!.length - 1
                ? leg.to.name
                : "Next turn",
            coordinate: coordinates[endIndex] as [number, number],
          },
          startTime,
          endTime,
          durationSeconds: instruction.durationSeconds,
          distanceMeters: instruction.distanceMeters,
          status: leg.status,
          geometry: {
            type: "LineString",
            coordinates: coordinates.slice(
              startIndex,
              endIndex + 1,
            ) as [number, number][],
          },
        };
      });
    }
    return [
      {
        id: `${leg.id}-walk`,
        kind: "walk",
        mode: leg.mode,
        instruction: `Walk from ${leg.from.name} to ${leg.to.name}.`,
        from: leg.from,
        to: leg.to,
        startTime: leg.startTime,
        endTime: leg.endTime,
        durationSeconds: leg.durationSeconds,
        distanceMeters: leg.distanceMeters,
        status: leg.status,
        geometry: leg.geometry,
      },
    ];
  }

  if (leg.mode === "DRIVE") {
    return [
      {
        id: `${leg.id}-drive`,
        kind: "ride",
        mode: leg.mode,
        instruction: `Drive from ${leg.from.name} to ${leg.to.name}.`,
        from: leg.from,
        to: leg.to,
        startTime: leg.startTime,
        endTime: leg.endTime,
        durationSeconds: leg.durationSeconds,
        distanceMeters: leg.distanceMeters,
        status: leg.status,
        geometry: leg.geometry,
      },
    ];
  }

  const routeName = leg.routeName || (leg.mode === "BUS" ? "the bus" : "the train");
  return [
    {
      id: `${leg.id}-board`,
      kind: "board",
      mode: leg.mode,
      instruction: `Board ${routeName} at ${leg.from.name}.`,
      from: leg.from,
      to: leg.from,
      ...zeroStepTime(leg.startTime),
      routeName: leg.routeName,
      stopId: leg.fromStopId,
      status: leg.status,
      delaySeconds: leg.delaySeconds,
    },
    {
      id: `${leg.id}-ride`,
      kind: "ride",
      mode: leg.mode,
      instruction: `Take ${routeName} to ${leg.to.name}.`,
      from: leg.from,
      to: leg.to,
      startTime: leg.startTime,
      endTime: leg.endTime,
      durationSeconds: leg.durationSeconds,
      distanceMeters: leg.distanceMeters,
      routeName: leg.routeName,
      status: leg.status,
      delaySeconds: leg.delaySeconds,
      geometry: leg.geometry,
    },
    {
      id: `${leg.id}-alight`,
      kind: "alight",
      mode: leg.mode,
      instruction: `Get off at ${leg.to.name}.`,
      from: leg.to,
      to: leg.to,
      ...zeroStepTime(leg.endTime),
      routeName: leg.routeName,
      stopId: leg.toStopId,
      status: leg.status,
      delaySeconds: leg.delaySeconds,
    },
  ];
}

export function routeStepsForItinerary(itinerary: TransitItinerary): RouteStep[] {
  return itinerary.legs.flatMap((leg) => leg.steps || routeStepsForLeg(leg));
}

export function routeOptionForItinerary(
  itinerary: ScoredItinerary,
): RouteOption {
  return {
    ...itinerary,
    steps: routeStepsForItinerary(itinerary),
  };
}
