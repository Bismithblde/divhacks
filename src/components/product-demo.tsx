"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BusFront,
  Car,
  Check,
  ChevronLeft,
  Clock3,
  Footprints,
  Info,
  Map,
  Search,
  TrainFront,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./product-demo.module.css";

type ScreenId = "home" | "routes" | "trip" | "update" | "closures" | "closure";
type DestinationId = "union" | "moma" | "bridge";
type Mode = "transit" | "walk" | "drive";
type Decision = "switch" | "stay" | null;
type Tone = "warning" | "error" | "info" | "ok";

type Destination = {
  id: DestinationId;
  name: string;
  detail: string;
  pin: { x: number; y: number; label: string };
};

type SampleRoute = {
  id: string;
  title: string;
  detail: string;
  minutes: number;
  arrive: string;
  leave: string;
  walking: string;
  transfers: string;
  note: string;
  path: string;
  kind: "transit" | "walk" | "bus" | "drive";
  caution?: { tone: Tone; text: string };
};

type Leg = { kind: "walk" | "subway" | "bus"; title: string; detail: string; time: string };

type Adaptation = {
  headline: string;
  reason: string;
  stayLabel: string;
  stayDetail: string;
  alternate: SampleRoute | null;
};

type Closure = {
  id: string;
  title: string;
  where: string;
  kind: string;
  blocks: string;
  until: string;
  sidewalk: "open" | "blocked";
  related: DestinationId;
  blurb: string;
  mark: { x: number; y: number };
};

const ORIGIN = { x: 48, y: 610, label: "Columbia" };

const DESTINATIONS: Destination[] = [
  {
    id: "union",
    name: "Union Square",
    detail: "14th Street, Manhattan",
    pin: { x: 227, y: 369, label: "Union Sq" },
  },
  {
    id: "moma",
    name: "Museum of Modern Art",
    detail: "11 West 53rd Street",
    pin: { x: 227, y: 128, label: "MoMA" },
  },
  {
    id: "bridge",
    name: "Brooklyn Bridge",
    detail: "Pedestrian entrance",
    pin: { x: 312, y: 455, label: "Bridge" },
  },
];

const CLOSURES: Closure[] = [
  {
    id: "broadway",
    title: "Broadway",
    where: "W 96 St to W 110 St",
    kind: "Parade",
    blocks: "Street and the west sidewalk",
    until: "Until 8:00 PM",
    sidewalk: "blocked",
    related: "union",
    blurb: "A permitted parade. The sample 1 train plan does not use this sidewalk.",
    mark: { x: 168, y: 500 },
  },
  {
    id: "fifth",
    title: "5th Avenue",
    where: "E 42 St to E 59 St",
    kind: "Vehicle closure",
    blocks: "Vehicle lanes",
    until: "Until 6:00 PM",
    sidewalk: "open",
    related: "moma",
    blurb:
      "A vehicle closure does not automatically close the sidewalk. Pedestrian crossings in this sample stay open.",
    mark: { x: 250, y: 176 },
  },
  {
    id: "bridge",
    title: "Brooklyn Bridge",
    where: "Vehicle lanes",
    kind: "Film shoot",
    blocks: "Vehicle lanes only",
    until: "Until 9:00 PM",
    sidewalk: "open",
    related: "bridge",
    blurb: "Cars are held. The pedestrian path in this sample is still open.",
    mark: { x: 334, y: 508 },
  },
];

const DEADLINES = [
  { label: "Today, 6:30 PM", note: "The recommended sample plan is built to arrive by 6:30 PM.", tone: "ok" as const },
  { label: "Today, 7:00 PM", note: "You would have about 30 extra minutes in this sample.", tone: "ok" as const },
  { label: "Today, 5:45 PM", note: "These sample routes arrive after a 5:45 PM deadline.", tone: "warning" as const },
];

const MOMENTS: Record<ScreenId, { body: string; tap: string }> = {
  home: {
    body: "Tell Wrap where you need to be. Search or tap a place, then ask for a route. The phone moves only when you do.",
    tap: "Tap Union Square, MoMA, or the Brooklyn Bridge.",
  },
  routes: {
    body: "Compare a subway, a bus, and a walk that treats the closure as a real barrier. The line on the map follows the card you tap.",
    tap: "Tap a route, then start the trip.",
  },
  trip: {
    body: "This plan starts at Columbia University. It is a sample illustration, not a promise the street is clear.",
    tap: "Tap “Something changed?” to recheck the trip.",
  },
  update: {
    body: "Wrap lays out staying against switching. You make the call. Nothing in this demo advances on its own.",
    tap: "Tap switch or stay.",
  },
  closures: {
    body: "Sample permits, parades, and a film shoot. A closed vehicle lane can still leave the sidewalk open.",
    tap: "Tap a closure to read what it blocks.",
  },
  closure: {
    body: "This is a sample permit, not a live feed. Plan around it, or go back to the list.",
    tap: "Tap “Plan around this,” or go back.",
  },
};

const PATH = {
  unionTrain: "M48 610 C48 520 56 430 86 369 C140 348 184 358 227 369",
  unionBus: "M48 610 C78 590 120 530 156 470 C190 412 208 386 227 369",
  unionWalk: "M48 610 C36 490 34 360 108 292 C156 248 186 310 227 369",
  unionDrive: "M48 610 C96 586 140 548 168 500 C198 448 214 404 227 369",
  momaTrain: "M48 610 C78 470 130 280 227 128",
  momaWalk: "M48 610 C40 450 70 250 150 186 C186 156 206 140 227 128",
  momaDrive: "M48 610 C120 520 210 300 250 190 C252 160 242 140 227 128",
  bridgeWalk: "M48 610 C96 598 160 548 214 500 C258 462 286 450 312 455",
  bridgeTrain: "M48 610 C90 560 150 520 214 492 C262 470 290 460 312 455",
  bridgeDrive: "M48 610 C130 604 210 560 270 524 C310 498 338 492 312 455",
};

function route(
  partial: Omit<SampleRoute, "arrive" | "leave"> & { arrive?: string; leave?: string },
): SampleRoute {
  return {
    arrive: partial.arrive ?? "6:30 PM",
    leave: partial.leave ?? "5:56 PM",
    ...partial,
  };
}

const ROUTES = {
  train: route({
    id: "1-train",
    title: "1 train",
    detail: "116 St → 14 St–Union Sq",
    minutes: 34,
    walking: "8 min walk",
    transfers: "0 transfers",
    note: "Stays off the closed Broadway sidewalk.",
    path: PATH.unionTrain,
    kind: "transit",
    caution: {
      tone: "warning",
      text: "Broadway from W 96 St to W 110 St is closed for a parade. This plan does not use that sidewalk.",
    },
  }),
  bus: route({
    id: "m7",
    title: "M7 bus",
    detail: "116 St → Union Square",
    minutes: 39,
    arrive: "6:35 PM",
    walking: "7 min walk",
    transfers: "0 transfers",
    note: "Sample schedule. Not a live bus.",
    path: PATH.unionBus,
    kind: "bus",
  }),
  busFast: route({
    id: "m7-fast",
    title: "M7 bus",
    detail: "116 St → Union Square",
    minutes: 29,
    arrive: "6:25 PM",
    walking: "7 min walk",
    transfers: "0 transfers",
    note: "Faster than waiting for the slowed 1 train, in this sample.",
    path: PATH.unionBus,
    kind: "bus",
    caution: {
      tone: "ok",
      text: "You switched to the M7. This is a sample schedule, not a live departure.",
    },
  }),
  walkUnion: route({
    id: "walk-union",
    title: "Walk around it",
    detail: "Amsterdam Ave, then east",
    minutes: 41,
    arrive: "6:37 PM",
    walking: "41 min walk",
    transfers: "Walking only",
    note: "Goes around the parade instead of through it.",
    path: PATH.unionWalk,
    kind: "walk",
  }),
  driveUnion: route({
    id: "drive-union",
    title: "Driving sketch",
    detail: "Broadway, then east",
    minutes: 22,
    arrive: "6:18 PM",
    walking: "2 min walk",
    transfers: "Sample drive",
    note: "Turn restrictions are not applied.",
    path: PATH.unionDrive,
    kind: "drive",
    caution: {
      tone: "error",
      text: "This sketch meets the Broadway closure. Driving turn restrictions are not in this demo.",
    },
  }),
  eTrain: route({
    id: "e-train",
    title: "E train",
    detail: "116 St → 5 Av/53 St",
    minutes: 27,
    arrive: "4:00 PM",
    leave: "3:33 PM",
    walking: "6 min walk",
    transfers: "0 transfers",
    note: "Sample subway schedule to MoMA.",
    path: PATH.momaTrain,
    kind: "transit",
  }),
  walkMoma: route({
    id: "walk-moma",
    title: "Walk",
    detail: "West side, then 53rd St",
    minutes: 48,
    arrive: "4:21 PM",
    leave: "3:33 PM",
    walking: "48 min walk",
    transfers: "Walking only",
    note: "Uses sidewalks that stay open in this sample.",
    path: PATH.momaWalk,
    kind: "walk",
    caution: {
      tone: "info",
      text: "5th Avenue is closed to vehicles near here. The sidewalk in this sample is still open.",
    },
  }),
  walkMomaEnd: route({
    id: "walk-moma-end",
    title: "Walk the last stretch",
    detail: "Leave the E at Lexington",
    minutes: 35,
    arrive: "4:08 PM",
    leave: "3:33 PM",
    walking: "14 min walk",
    transfers: "0 transfers",
    note: "Eight blocks on an open sidewalk instead of waiting.",
    path: PATH.momaWalk,
    kind: "walk",
  }),
  driveMoma: route({
    id: "drive-moma",
    title: "Driving sketch",
    detail: "Up 5th, then west",
    minutes: 18,
    arrive: "3:51 PM",
    leave: "3:33 PM",
    walking: "1 min walk",
    transfers: "Sample drive",
    note: "Crosses a vehicle closure on 5th Avenue.",
    path: PATH.momaDrive,
    kind: "drive",
    caution: {
      tone: "error",
      text: "5th Avenue is closed to vehicles in this sample. The sidewalk beside it is not.",
    },
  }),
  walkBridge: route({
    id: "walk-bridge",
    title: "Walk the path",
    detail: "Pedestrian entrance",
    minutes: 44,
    arrive: "5:15 PM",
    leave: "4:31 PM",
    walking: "44 min walk",
    transfers: "Walking only",
    note: "The vehicle lanes are closed. This path is not.",
    path: PATH.bridgeWalk,
    kind: "walk",
    caution: {
      tone: "info",
      text: "A film shoot is holding cars. The pedestrian path in this sample stays open.",
    },
  }),
  trainBridge: route({
    id: "train-bridge",
    title: "1 train + walk",
    detail: "116 St → Chambers St",
    minutes: 39,
    arrive: "5:10 PM",
    leave: "4:31 PM",
    walking: "12 min walk",
    transfers: "0 transfers",
    note: "Then the pedestrian path onto the bridge.",
    path: PATH.bridgeTrain,
    kind: "transit",
  }),
  driveBridge: route({
    id: "drive-bridge",
    title: "Driving sketch",
    detail: "Toward the vehicle lanes",
    minutes: 24,
    arrive: "4:55 PM",
    leave: "4:31 PM",
    walking: "0 min walk",
    transfers: "Sample drive",
    note: "Those lanes are closed for a shoot.",
    path: PATH.bridgeDrive,
    kind: "drive",
    caution: {
      tone: "error",
      text: "This sketch uses the closed vehicle lanes. Walkers in this sample still have a path.",
    },
  }),
};

const LEGS: Record<string, Leg[]> = {
  "1-train": [
    { kind: "walk", title: "Walk", detail: "Campus to 116 St", time: "4 min" },
    { kind: "subway", title: "1 train", detail: "116 St → 14 St–Union Sq", time: "26 min" },
    { kind: "walk", title: "Walk", detail: "Station to Union Square", time: "4 min" },
  ],
  m7: [
    { kind: "walk", title: "Walk", detail: "Campus to the M7 stop", time: "3 min" },
    { kind: "bus", title: "M7", detail: "116 St → Union Square", time: "32 min" },
    { kind: "walk", title: "Walk", detail: "Stop to Union Square", time: "4 min" },
  ],
  "m7-fast": [
    { kind: "walk", title: "Walk", detail: "Campus to the M7 stop", time: "3 min" },
    { kind: "bus", title: "M7", detail: "116 St → Union Square", time: "22 min" },
    { kind: "walk", title: "Walk", detail: "Stop to Union Square", time: "4 min" },
  ],
  "walk-union": [
    { kind: "walk", title: "Walk", detail: "Amsterdam Ave around the parade", time: "32 min" },
    { kind: "walk", title: "Walk", detail: "East to Union Square", time: "9 min" },
  ],
  "e-train": [
    { kind: "walk", title: "Walk", detail: "Campus to the E", time: "4 min" },
    { kind: "subway", title: "E train", detail: "116 St → 5 Av/53 St", time: "19 min" },
    { kind: "walk", title: "Walk", detail: "53rd Street to MoMA", time: "4 min" },
  ],
  "walk-moma-end": [
    { kind: "subway", title: "E train", detail: "116 St → Lexington Av/53 St", time: "17 min" },
    { kind: "walk", title: "Walk", detail: "Along 53rd on an open sidewalk", time: "14 min" },
  ],
  "train-bridge": [
    { kind: "subway", title: "1 train", detail: "116 St → Chambers St", time: "27 min" },
    { kind: "walk", title: "Walk", detail: "Pedestrian path onto the bridge", time: "12 min" },
  ],
};

function sampleRoutes(destination: DestinationId, mode: Mode): SampleRoute[] {
  if (destination === "union") {
    if (mode === "walk") return [ROUTES.walkUnion];
    if (mode === "drive") return [ROUTES.driveUnion, ROUTES.walkUnion];
    return [ROUTES.train, ROUTES.bus, ROUTES.walkUnion];
  }
  if (destination === "moma") {
    if (mode === "walk") return [ROUTES.walkMoma];
    if (mode === "drive") return [ROUTES.driveMoma, ROUTES.walkMoma];
    return [ROUTES.eTrain, ROUTES.walkMoma];
  }
  if (mode === "drive") return [ROUTES.driveBridge, ROUTES.walkBridge];
  if (mode === "walk") return [ROUTES.walkBridge];
  return [ROUTES.walkBridge, ROUTES.trainBridge];
}

function adaptationFor(destination: DestinationId, routeId: string): Adaptation {
  if (destination === "union" && routeId === "1-train") {
    return {
      headline: "The 1 train slowed down.",
      reason: "It is about 11 minutes slower than the schedule this sample used.",
      stayLabel: "Stay on the 1",
      stayDetail: "Arrive about 6:41 PM, 11 minutes behind the 6:30 deadline in this sample.",
      alternate: ROUTES.busFast,
    };
  }
  if (destination === "union" && routeId === "drive-union") {
    return {
      headline: "This drive meets the closure.",
      reason: "Broadway is still shut for the parade. A walk around it avoids that block.",
      stayLabel: "Keep the driving sketch",
      stayDetail: "You would still be aimed at a closed street. Turn restrictions are not applied.",
      alternate: ROUTES.walkUnion,
    };
  }
  if (destination === "moma" && routeId === "e-train") {
    return {
      headline: "The E train is held.",
      reason: "Walking the last stretch on 53rd keeps you on a sidewalk this sample still marks open.",
      stayLabel: "Wait for the E",
      stayDetail: "Stay on the train. The hold is about 8 minutes in this sample.",
      alternate: ROUTES.walkMomaEnd,
    };
  }
  if (destination === "moma" && routeId === "drive-moma") {
    return {
      headline: "5th Avenue is closed to cars.",
      reason: "The sidewalk beside it is still open in this sample.",
      stayLabel: "Keep the driving sketch",
      stayDetail: "You would still be pointed at the vehicle closure.",
      alternate: ROUTES.walkMoma,
    };
  }
  if (routeId === "train-bridge" || routeId === "drive-bridge") {
    return {
      headline: "Vehicle lanes are closed.",
      reason: "The film shoot holds cars. It does not close the pedestrian path in this sample.",
      stayLabel: routeId === "drive-bridge" ? "Keep the driving sketch" : "Stay on the 1",
      stayDetail:
        routeId === "drive-bridge"
          ? "That sketch still uses the closed lanes."
          : "The train is fine. You still finish on the open path.",
      alternate: routeId === "drive-bridge" ? ROUTES.walkBridge : null,
    };
  }
  return {
    headline: "This plan already goes around it.",
    reason: "The sample permits have not changed the route you picked.",
    stayLabel: "Keep this plan",
    stayDetail: "Stay with the route on screen. It is still a sample, not a guarantee.",
    alternate: null,
  };
}

function destinationById(id: DestinationId) {
  return DESTINATIONS.find((item) => item.id === id) ?? DESTINATIONS[0];
}

function closureById(id: string) {
  return CLOSURES.find((item) => item.id === id) ?? CLOSURES[0];
}

function marksFor(screen: ScreenId, destination: DestinationId | null, closureId: string | null) {
  if (screen === "closures") return CLOSURES;
  if (screen === "closure" && closureId) return [closureById(closureId)];
  if (!destination) return [];
  return CLOSURES.filter((item) => item.related === destination);
}

function ghostFor(destination: DestinationId | null, route: SampleRoute | null) {
  if (destination === "union" && route && route.kind !== "drive") return PATH.unionDrive;
  return null;
}

function modeLabel(mode: Mode) {
  if (mode === "walk") return "Walk";
  if (mode === "drive") return "Drive";
  return "Transit";
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "walk") return <Footprints size={16} aria-hidden="true" />;
  if (mode === "drive") return <Car size={16} aria-hidden="true" />;
  return <TrainFront size={16} aria-hidden="true" />;
}

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

function motionMs() {
  if (typeof window === "undefined") return 420;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : 460;
}

function StatusBar() {
  return (
    <div className={styles.status}>
      <span className={styles.statusTime}>9:41</span>
      <span className={styles.statusIcons} aria-hidden="true">
        <svg width="17" height="12" viewBox="0 0 17 12">
          <rect x="0" y="7" width="3" height="5" rx="0.6" fill="currentColor" />
          <rect x="4.5" y="5" width="3" height="7" rx="0.6" fill="currentColor" />
          <rect x="9" y="2.5" width="3" height="9.5" rx="0.6" fill="currentColor" />
          <rect x="13.5" y="0" width="3" height="12" rx="0.6" fill="currentColor" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12">
          <path d="M8 9.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z" fill="currentColor" />
          <path d="M3.2 7.2a6.6 6.6 0 0 1 9.6 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M1 4.6a9.6 9.6 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.7" y="0.7" width="21" height="10.6" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="2.2" y="2.2" width="16" height="7.6" rx="1" fill="currentColor" />
          <rect x="22.4" y="4" width="1.6" height="4" rx="0.5" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

function BrandMark() {
  return (
    <span className={styles.brand}>
      <span className={styles.mark}>
        <Image src="/brand/wrap-light.png" alt="" width={28} height={28} className={styles.markLight} />
        <Image src="/brand/wrap-dark.png" alt="" width={28} height={28} className={styles.markDark} />
      </span>
      Wrap
    </span>
  );
}

function DemoMap({
  destination,
  primary,
  alternate,
  ghost,
  marks,
  hotId,
  traveling,
}: {
  destination: Destination | null;
  primary: string | null;
  alternate: string | null;
  ghost: string | null;
  marks: Closure[];
  hotId: string | null;
  traveling: boolean;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot || !traveling) return;
    const length = path.getTotalLength();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const start = performance.now();
    const duration = reduce ? 0 : 1500;
    const tick = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const point = path.getPointAtLength(length * eased * 0.84);
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("opacity", "1");
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [traveling, primary]);

  return (
    <svg className={styles.mapSvg} viewBox="0 0 360 660" role="img" aria-label="Illustrative map from Columbia University">
      <rect width="360" height="660" fill="#e7f0ea" />
      <rect className={styles.water} width="30" height="660" />
      <rect className={styles.water} x="332" width="28" height="660" />
      <text className={styles.waterLabel} x="16" y="340" transform="rotate(-90 16 340)">
        HUDSON
      </text>
      <text className={styles.waterLabel} x="348" y="300" transform="rotate(90 348 300)">
        EAST RIVER
      </text>
      { [58, 148, 238].map((x, column) =>
        [28, 112, 196, 280, 364, 448].map((y, row) => (
          <rect
            key={`${column}-${row}`}
            className={column === 1 && row < 2 ? styles.park : styles.block}
            x={x}
            y={y}
            width="72"
            height="66"
            rx="8"
          />
        )),
      )}
      {ghost && <path className={styles.routeGhost} d={ghost} />}
      {alternate && <path className={styles.routeAlt} d={alternate} />}
      {primary && (
        <>
          <path className={cx(styles.routeCasing, styles.draw)} pathLength={1} d={primary} />
          <path
            ref={pathRef}
            data-route="active"
            className={cx(styles.routePrimary, styles.draw)}
            pathLength={1}
            d={primary}
          />
        </>
      )}
      <circle className={styles.traveler} cx={ORIGIN.x} cy={ORIGIN.y} r="6" fill="#181818" stroke="#fff" strokeWidth="3" />
      <text className={styles.pinLabel} x={ORIGIN.x + 12} y={ORIGIN.y + 4}>
        {ORIGIN.label}
      </text>
      {destination && (
        <>
          <circle cx={destination.pin.x} cy={destination.pin.y} r="8" fill="#326448" stroke="#fff" strokeWidth="3" />
          <text
            className={styles.pinLabel}
            x={destination.pin.x > 250 ? destination.pin.x - 12 : destination.pin.x + 14}
            y={destination.pin.y - 12}
            textAnchor={destination.pin.x > 250 ? "end" : "start"}
          >
            {destination.pin.label}
          </text>
        </>
      )}
      {marks.map((mark) => (
        <g key={mark.id} transform={`translate(${mark.mark.x} ${mark.mark.y})`}>
          <circle r="11" className={cx(styles.closureRing, hotId === mark.id && styles.closureHot)} />
          <path className={styles.closureX} d="M-4 -4 L4 4 M4 -4 L-4 4" />
        </g>
      ))}
      {traveling && <circle ref={dotRef} className={styles.traveler} r="6" opacity="0" />}
    </svg>
  );
}

export function ProductDemo() {
  const [screen, setScreen] = useState<ScreenId>("home");
  const [outgoing, setOutgoing] = useState<{ id: ScreenId; dir: "forward" | "back" } | null>(null);
  const [query, setQuery] = useState("");
  const [destinationId, setDestinationId] = useState<DestinationId | null>(null);
  const [mode, setMode] = useState<Mode>("transit");
  const [deadlineIndex, setDeadlineIndex] = useState(0);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [closureId, setClosureId] = useState<string | null>(null);
  const [originOpen, setOriginOpen] = useState(false);
  const historyRef = useRef<ScreenId[]>([]);
  const lockRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const seenScreen = useRef<ScreenId>("home");
  const destination = destinationId ? destinationById(destinationId) : null;
  const deadline = DEADLINES[deadlineIndex];
  const options = destinationId ? sampleRoutes(destinationId, mode) : [];
  const selected = options.find((item) => item.id === routeId) ?? options[0] ?? null;
  const adaptation = destinationId && selected ? adaptationFor(destinationId, selected.id) : null;
  const shown = decision === "switch" && adaptation?.alternate ? adaptation.alternate : selected;
  const closure = closureId ? closureById(closureId) : null;
  const matches = DESTINATIONS.filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${item.name} ${item.detail}`.toLowerCase().includes(needle);
  });

  const navigate = useCallback((next: ScreenId, dir: "forward" | "back", remember: boolean) => {
    if (lockRef.current) return;
    if (next === screen) return;
    lockRef.current = true;
    if (remember && dir === "forward") historyRef.current = [...historyRef.current, screen];
    setOutgoing({ id: screen, dir });
    setScreen(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOutgoing(null);
      lockRef.current = false;
      timerRef.current = null;
    }, motionMs());
  }, [screen]);

  const back = useCallback(() => {
    if (lockRef.current) return;
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    navigate(previous, "back", false);
  }, [navigate]);

  const go = useCallback((next: ScreenId) => navigate(next, "forward", true), [navigate]);

  const resetFields = () => {
    setQuery("");
    setDestinationId(null);
    setMode("transit");
    setDeadlineIndex(0);
    setRouteId(null);
    setDecision(null);
    setClosureId(null);
    setOriginOpen(false);
  };

  const restart = () => {
    if (lockRef.current) return;
    historyRef.current = [];
    if (screen === "home") {
      resetFields();
      return;
    }
    navigate("home", "back", false);
    window.setTimeout(resetFields, motionMs());
  };

  const pickDestination = (id: DestinationId) => {
    const next = destinationById(id);
    setDestinationId(id);
    setQuery(next.name);
    setRouteId(null);
    setDecision(null);
  };

  const openRoutes = (id = destinationId) => {
    if (!id) return;
    const nextOptions = sampleRoutes(id, mode);
    setDestinationId(id);
    setRouteId(nextOptions[0]?.id ?? null);
    setDecision(null);
    go("routes");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (seenScreen.current === screen) return;
    seenScreen.current = screen;
    document.getElementById("demo-screen-heading")?.focus({ preventScroll: true });
  }, [screen]);

  const flow = screen === "closures" || screen === "closure"
    ? (["home", "closures", "closure"] as const)
    : (["home", "routes", "trip", "update"] as const);
  const flowLabel: Record<string, string> = {
    home: "Plan",
    routes: "Routes",
    trip: "Trip",
    update: "Update",
    closures: "Closures",
    closure: "Detail",
  };

  return (
    <main className={styles.page}>
      <section className={styles.copy} aria-labelledby="demo-title">
        <p className={styles.kicker}>Product demo</p>
        <h1 id="demo-title" className={styles.title}>
          When New York changes, <em>Wrap.</em>
        </h1>
        <p key={screen} className={styles.moment} aria-live="polite">
          {MOMENTS[screen].body}
        </p>
        <p className={styles.tap}>{MOMENTS[screen].tap}</p>
        <ol className={styles.steps} aria-label="Demo flow">
          {flow.map((step) => (
            <li key={step} className={step === screen ? styles.stepOn : undefined} aria-current={step === screen ? "step" : undefined}>
              {flowLabel[step]}
            </li>
          ))}
        </ol>
        <p className={styles.disclaimer}>
          Sample data for a hackathon demo. Not live routing, and not a guarantee the way is clear.
        </p>
        <div className={styles.actions}>
          <Link className={styles.linkButton} href="/">
            Open Wrap
          </Link>
          <button className={styles.textButton} type="button" onClick={restart}>
            Start over
          </button>
        </div>
      </section>

      <div className={styles.stage}>
        <div className={styles.device}>
          <span className={styles.silent} aria-hidden="true" />
          <span className={cx(styles.volume, styles.volumeUp)} aria-hidden="true" />
          <span className={cx(styles.volume, styles.volumeDown)} aria-hidden="true" />
          <span className={styles.power} aria-hidden="true" />
          <div className={styles.bezel}>
            <div
              className={styles.screen}
              role="region"
              aria-label="Wrap demo on an iPhone"
              data-screen={screen}
              data-testid="product-demo-phone"
            >
              <div className={styles.island} aria-hidden="true">
                <span className={styles.islandCam} />
              </div>
              <StatusBar />
              <div className={styles.viewport}>
                {outgoing && (
                  <div className={cx(styles.pane, outgoing.dir === "forward" ? styles.leaveForward : styles.leaveBack)} inert>
                    <PhoneScreen
                      id={outgoing.id}
                      active={false}
                      query={query}
                      matches={matches}
                      destination={destination}
                      destinationId={destinationId}
                      mode={mode}
                      deadlineIndex={deadlineIndex}
                      deadline={deadline}
                      options={options}
                      selected={selected}
                      shown={shown}
                      decision={decision}
                      adaptation={adaptation}
                      closure={closure}
                      originOpen={originOpen}
                      onQuery={setQuery}
                      onClearQuery={() => {
                        setQuery("");
                        setDestinationId(null);
                      }}
                      onPick={pickDestination}
                      onMode={setMode}
                      onDeadline={() => setDeadlineIndex((index) => (index + 1) % DEADLINES.length)}
                      onSubmit={() => openRoutes()}
                      onSelectRoute={(id) => {
                        setRouteId(id);
                        setDecision(null);
                      }}
                      onStart={() => go("trip")}
                      onRecheck={() => go("update")}
                      onDecide={(next) => {
                        setDecision(next);
                        back();
                      }}
                      onClosures={() => go("closures")}
                      onOpenClosure={(id) => {
                        setClosureId(id);
                        go("closure");
                      }}
                      onPlanAround={() => {
                        if (!closure) return;
                        const related = destinationById(closure.related);
                        setQuery(related.name);
                        setDestinationId(closure.related);
                        setMode("transit");
                        setDecision(null);
                        const nextOptions = sampleRoutes(closure.related, "transit");
                        setRouteId(nextOptions[0]?.id ?? null);
                        go("routes");
                      }}
                      onOrigin={() => setOriginOpen((open) => !open)}
                      onBack={back}
                    />
                  </div>
                )}
                <div className={cx(styles.pane, outgoing && (outgoing.dir === "forward" ? styles.enterForward : styles.enterBack))}>
                  <PhoneScreen
                    id={screen}
                    active
                    query={query}
                    matches={matches}
                    destination={destination}
                    destinationId={destinationId}
                    mode={mode}
                    deadlineIndex={deadlineIndex}
                    deadline={deadline}
                    options={options}
                    selected={selected}
                    shown={shown}
                    decision={decision}
                    adaptation={adaptation}
                    closure={closure}
                    originOpen={originOpen}
                    onQuery={(value) => {
                      setQuery(value);
                      setDestinationId(null);
                    }}
                    onClearQuery={() => {
                      setQuery("");
                      setDestinationId(null);
                    }}
                    onPick={pickDestination}
                    onMode={setMode}
                    onDeadline={() => setDeadlineIndex((index) => (index + 1) % DEADLINES.length)}
                    onSubmit={() => openRoutes()}
                    onSelectRoute={(id) => {
                      setRouteId(id);
                      setDecision(null);
                    }}
                    onStart={() => go("trip")}
                    onRecheck={() => go("update")}
                    onDecide={(next) => {
                      setDecision(next);
                      back();
                    }}
                    onClosures={() => go("closures")}
                    onOpenClosure={(id) => {
                      setClosureId(id);
                      go("closure");
                    }}
                    onPlanAround={() => {
                      if (!closure) return;
                      const related = destinationById(closure.related);
                      setQuery(related.name);
                      setDestinationId(closure.related);
                      setMode("transit");
                      setDecision(null);
                      const nextOptions = sampleRoutes(closure.related, "transit");
                      setRouteId(nextOptions[0]?.id ?? null);
                      go("routes");
                    }}
                    onOrigin={() => setOriginOpen((open) => !open)}
                    onBack={back}
                  />
                </div>
              </div>
              <div className={styles.indicator} aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function PhoneScreen(props: {
  id: ScreenId;
  active: boolean;
  query: string;
  matches: Destination[];
  destination: Destination | null;
  destinationId: DestinationId | null;
  mode: Mode;
  deadlineIndex: number;
  deadline: (typeof DEADLINES)[number];
  options: SampleRoute[];
  selected: SampleRoute | null;
  shown: SampleRoute | null;
  decision: Decision;
  adaptation: Adaptation | null;
  closure: Closure | null;
  originOpen: boolean;
  onQuery: (value: string) => void;
  onClearQuery: () => void;
  onPick: (id: DestinationId) => void;
  onMode: (mode: Mode) => void;
  onDeadline: () => void;
  onSubmit: () => void;
  onSelectRoute: (id: string) => void;
  onStart: () => void;
  onRecheck: () => void;
  onDecide: (decision: "switch" | "stay") => void;
  onClosures: () => void;
  onOpenClosure: (id: string) => void;
  onPlanAround: () => void;
  onOrigin: () => void;
  onBack: () => void;
}) {
  if (props.id === "home") return <HomeScreen {...props} />;
  if (props.id === "routes") return <RoutesScreen {...props} />;
  if (props.id === "trip") return <TripScreen {...props} />;
  if (props.id === "update") return <UpdateScreen {...props} />;
  if (props.id === "closure") return <ClosureScreen {...props} />;
  return <ClosuresScreen {...props} />;
}

function HomeScreen({
  active,
  query,
  matches,
  destinationId,
  mode,
  deadline,
  originOpen,
  onQuery,
  onClearQuery,
  onPick,
  onMode,
  onDeadline,
  onSubmit,
  onClosures,
  onOrigin,
}: {
  active: boolean;
  query: string;
  matches: Destination[];
  destinationId: DestinationId | null;
  mode: Mode;
  deadline: (typeof DEADLINES)[number];
  originOpen: boolean;
  onQuery: (value: string) => void;
  onClearQuery: () => void;
  onPick: (id: DestinationId) => void;
  onMode: (mode: Mode) => void;
  onDeadline: () => void;
  onSubmit: () => void;
  onClosures: () => void;
  onOrigin: () => void;
}) {
  return (
    <div className={styles.home}>
      <header className={styles.phoneHeader}>
        <BrandMark />
        <button className={styles.iconButton} type="button" onClick={onClosures}>
          <Map size={16} aria-hidden="true" />
          Map
        </button>
      </header>
      <p className={styles.eyebrow}>NYC trip autopilot</p>
      <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.heroTitle}>
        Get there without guessing.
      </h2>
      <p className={styles.lede}>
        Tell us where you need to be and when. We compare subway, bus, and walking options.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={active ? "demo-destination" : undefined}>
            Where are you going?
          </label>
          <div className={styles.inputWrap}>
            <Search size={18} aria-hidden="true" />
            <input
              id={active ? "demo-destination" : undefined}
              className={styles.input}
              value={query}
              placeholder="Address, station, or landmark"
              autoComplete="off"
              onChange={(event) => onQuery(event.target.value)}
            />
            {query && (
              <button className={styles.clear} type="button" aria-label="Clear destination" onClick={onClearQuery}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <ul className={styles.results}>
            {matches.map((item, index) => (
              <li key={item.id}>
                <button
                  className={cx(styles.result, destinationId === item.id && styles.resultOn, !destinationId && index === 0 && styles.hint)}
                  type="button"
                  aria-pressed={destinationId === item.id}
                  onClick={() => onPick(item.id)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
                  </span>
                  {destinationId === item.id && <Check size={16} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p className={styles.fine}>No places in this sample match that search.</p>}
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Arrive by</span>
          <button className={styles.deadline} type="button" onClick={onDeadline}>
            <Clock3 size={16} aria-hidden="true" />
            {deadline.label}
          </button>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Travel mode</span>
          <div className={styles.segment} role="group" aria-label="Travel mode">
            {(["transit", "walk", "drive"] as const).map((item) => (
              <button
                key={item}
                className={mode === item ? styles.segmentOn : undefined}
                type="button"
                aria-pressed={mode === item}
                onClick={() => onMode(item)}
              >
                <ModeIcon mode={item} />
                {modeLabel(item)}
              </button>
            ))}
          </div>
        </div>
        <button className={cx(styles.submit, destinationId && styles.hint)} type="submit" disabled={!destinationId}>
          Get me there
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
      <p className={styles.originRow}>
        Starting from Columbia University.
        <button className={styles.linkish} type="button" onClick={onOrigin}>
          {originOpen ? "Hide origin" : "Change origin"}
        </button>
        <button className={styles.linkish} type="button" onClick={onClosures}>
          Explore disruptions
        </button>
      </p>
      {originOpen && (
        <p className={styles.originPanel}>
          Columbia University is the labeled demo origin when browser location is unavailable.
        </p>
      )}
      <p className={styles.fine}>Live estimates are not guarantees.</p>
    </div>
  );
}

function RoutesScreen({
  active,
  destination,
  destinationId,
  mode,
  deadline,
  options,
  selected,
  onSelectRoute,
  onStart,
  onDeadline,
  onBack,
}: {
  active: boolean;
  destination: Destination | null;
  destinationId: DestinationId | null;
  mode: Mode;
  deadline: (typeof DEADLINES)[number];
  options: SampleRoute[];
  selected: SampleRoute | null;
  onSelectRoute: (id: string) => void;
  onStart: () => void;
  onDeadline: () => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.fill}>
      <div className={styles.mapWrap}>
        <DemoMap
          destination={destination}
          primary={selected?.path ?? null}
          alternate={null}
          ghost={ghostFor(destinationId, selected)}
          marks={marksFor("routes", destinationId, null)}
          hotId={null}
          traveling={false}
        />
        <div className={styles.floatBar}>
          <button className={styles.floatButton} type="button" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
            Back
          </button>
          <span className={styles.samplePill}>Sample</span>
        </div>
      </div>
      <section className={cx(styles.sheet, styles.sheetIn)} aria-label="Route options">
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetTop}>
          <div>
            <p className={styles.eyebrow}>Routes to</p>
            <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.screenTitle}>
              {destination?.name ?? "your destination"}
            </h2>
          </div>
          <span className={styles.count}>
            {options.length} option{options.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className={styles.fine}>
          {mode === "drive"
            ? "Sample driving sketch. Turn restrictions are not applied."
            : mode === "walk"
              ? "Walking only. A closed vehicle lane may still leave the sidewalk open."
              : "Sample schedules. Not live departure times."}
        </p>
        <ul className={styles.routeList}>
          {options.map((option) => {
            const on = option.id === selected?.id;
            return (
              <li key={option.id}>
                <button
                  className={cx(styles.routeCard, on && styles.routeOn)}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelectRoute(option.id)}
                >
                  <span className={styles.minutes}>
                    {option.minutes}
                    <small>min</small>
                  </span>
                  <span>
                    <strong>{option.title}</strong>
                    <span className={styles.routeMeta}>
                      {option.detail}
                      <br />
                      {option.transfers} · {option.walking}
                    </span>
                  </span>
                  {on ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
        {selected && <p className={styles.fine}>{selected.note}</p>}
        <div className={cx(styles.banner, deadline.tone === "warning" ? undefined : styles.bannerOk)}>
          <Clock3 size={16} aria-hidden="true" />
          <span>{deadline.note}</span>
        </div>
        <button className={styles.deadline} type="button" onClick={onDeadline}>
          <Clock3 size={16} aria-hidden="true" />
          Arrive by {deadline.label}
        </button>
        <div className={styles.sheetAction}>
          <button className={cx(styles.submit, styles.hint)} type="button" onClick={onStart} disabled={!selected}>
            Start this trip
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}

function TripScreen({
  active,
  destination,
  destinationId,
  shown,
  decision,
  adaptation,
  onRecheck,
  onClosures,
  onBack,
}: {
  active: boolean;
  destination: Destination | null;
  destinationId: DestinationId | null;
  shown: SampleRoute | null;
  decision: Decision;
  adaptation: Adaptation | null;
  onRecheck: () => void;
  onClosures: () => void;
  onBack: () => void;
}) {
  const legs = shown
    ? LEGS[shown.id] ?? [
        {
          kind: shown.kind === "bus" ? "bus" as const : shown.kind === "transit" ? "subway" as const : "walk" as const,
          title: shown.title,
          detail: shown.detail,
          time: `${shown.minutes} min`,
        },
      ]
    : [];
  const banner = decision === "switch"
    ? { tone: "ok" as const, text: `Switched to ${shown?.title ?? "the new plan"}. Sample estimate, not a guarantee.` }
    : decision === "stay"
      ? { tone: "warning" as const, text: adaptation?.stayDetail ?? "Staying with this sample plan." }
      : shown?.caution
        ? shown.caution
        : null;

  return (
    <div className={styles.fill}>
      <div className={styles.mapWrap}>
        <DemoMap
          destination={destination}
          primary={shown?.path ?? null}
          alternate={null}
          ghost={ghostFor(destinationId, shown)}
          marks={marksFor("trip", destinationId, null)}
          hotId={null}
          traveling
        />
        <div className={styles.floatBar}>
          <button className={styles.floatButton} type="button" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
            Routes
          </button>
          <span className={styles.samplePill}>Sample</span>
        </div>
      </div>
      <section className={cx(styles.sheet, styles.sheetIn)} aria-label="Active sample trip">
        <div className={styles.handle} aria-hidden="true" />
        <p className={styles.eyebrow}>Recommended plan</p>
        <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.detailLead}>
          {shown?.title ?? "Your sample plan"}
        </h2>
        <p className={styles.lede}>{shown?.detail} · {destination?.name}</p>
        <div className={styles.summary}>
          <div>
            <strong>{shown?.leave}</strong>
            <span>Leave</span>
          </div>
          <ArrowRight size={16} aria-hidden="true" />
          <div>
            <strong>{shown?.arrive}</strong>
            <span>Arrive</span>
          </div>
        </div>
        {banner && (
          <div className={cx(styles.banner, banner.tone === "error" && styles.bannerError, banner.tone === "info" && styles.bannerInfo, banner.tone === "ok" && styles.bannerOk)}>
            {banner.tone === "info" ? <Info size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
            <span>{banner.text}</span>
          </div>
        )}
        <div className={styles.legs}>
          {legs.map((leg) => (
            <div className={styles.leg} key={`${leg.title}-${leg.detail}`}>
              <span className={cx(styles.legIcon, leg.kind === "bus" && styles.legIconBus, leg.kind === "walk" && styles.legIconWalk)}>
                {leg.kind === "bus" ? <BusFront size={15} aria-hidden="true" /> : leg.kind === "walk" ? <Footprints size={15} aria-hidden="true" /> : <TrainFront size={15} aria-hidden="true" />}
              </span>
              <span>
                <strong>{leg.title}</strong>
                <span className={styles.routeMeta}>{leg.detail}</span>
              </span>
              <span className={styles.legTime}>{leg.time}</span>
            </div>
          ))}
        </div>
        <div className={styles.sheetAction}>
          <button className={cx(styles.submit, styles.hint)} type="button" onClick={onRecheck}>
            Something changed? Recheck my trip
          </button>
          <button className={styles.secondary} type="button" onClick={onClosures}>
            View closures
          </button>
        </div>
      </section>
    </div>
  );
}

function UpdateScreen({
  active,
  destination,
  destinationId,
  selected,
  adaptation,
  onDecide,
  onBack,
}: {
  active: boolean;
  destination: Destination | null;
  destinationId: DestinationId | null;
  selected: SampleRoute | null;
  adaptation: Adaptation | null;
  onDecide: (decision: "switch" | "stay") => void;
  onBack: () => void;
}) {
  if (!adaptation || !selected) {
    return (
      <div className={styles.stack}>
        <button className={styles.backButton} type="button" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden="true" />
          Back
        </button>
        <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.heroTitle}>
          Pick a route first.
        </h2>
      </div>
    );
  }

  return (
    <div className={styles.fill}>
      <div className={styles.mapWrap}>
        <DemoMap
          destination={destination}
          primary={adaptation.alternate?.path ?? selected.path}
          alternate={adaptation.alternate ? selected.path : null}
          ghost={ghostFor(destinationId, selected)}
          marks={marksFor("update", destinationId, null)}
          hotId={null}
          traveling={false}
        />
        <div className={styles.floatBar}>
          <button className={styles.floatButton} type="button" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
            Trip
          </button>
          <span className={styles.samplePill}>Sample</span>
        </div>
      </div>
      <section className={cx(styles.sheet, styles.sheetIn)}>
        <div className={styles.handle} aria-hidden="true" />
        <p className={styles.eyebrow}>Trip update</p>
        <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.detailLead}>
          {adaptation.headline}
        </h2>
        <p className={styles.lede}>{adaptation.reason}</p>
        <div className={styles.choiceList}>
          {adaptation.alternate && (
            <button className={cx(styles.choice, styles.choicePrimary, styles.hint)} type="button" onClick={() => onDecide("switch")}>
              <strong>Switch to {adaptation.alternate.title}</strong>
              <span>
                {adaptation.alternate.minutes} min · arrive {adaptation.alternate.arrive}
              </span>
            </button>
          )}
          <button className={cx(styles.choice, !adaptation.alternate && styles.hint)} type="button" onClick={() => onDecide("stay")}>
            <strong>{adaptation.stayLabel}</strong>
            <span>{adaptation.stayDetail}</span>
          </button>
        </div>
        <p className={styles.fine}>Sample estimates. Not a guarantee the way is clear.</p>
      </section>
    </div>
  );
}

function ClosuresScreen({
  active,
  onOpenClosure,
  onBack,
}: {
  active: boolean;
  onOpenClosure: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.fill}>
      <div className={styles.mapWrap}>
        <DemoMap
          destination={null}
          primary={null}
          alternate={null}
          ghost={null}
          marks={CLOSURES}
          hotId={null}
          traveling={false}
        />
        <div className={styles.floatBar}>
          <button className={styles.floatButton} type="button" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
            Back
          </button>
          <span className={styles.samplePill}>Sample</span>
        </div>
      </div>
      <section className={cx(styles.sheet, styles.sheetIn)}>
        <div className={styles.handle} aria-hidden="true" />
        <p className={styles.eyebrow}>Disruptions</p>
        <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.screenTitle}>
          What is closed
        </h2>
        <p className={styles.fine}>Sample permits for this demo. A street missing from this list is not a promise that it is open.</p>
        <ul className={styles.closureList}>
          {CLOSURES.map((item, index) => (
            <li key={item.id}>
              <button className={cx(styles.closureCard, index === 0 && styles.hint)} type="button" onClick={() => onOpenClosure(item.id)}>
                <span className={cx(styles.kind, item.sidewalk === "open" && styles.kindOpen)}>{item.kind}</span>
                <strong>{item.title}</strong>
                <span>
                  {item.where} · {item.blocks}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ClosureScreen({
  active,
  closure,
  onPlanAround,
  onBack,
}: {
  active: boolean;
  closure: Closure | null;
  onPlanAround: () => void;
  onBack: () => void;
}) {
  const item = closure ?? CLOSURES[0];
  const related = destinationById(item.related);
  return (
    <div className={styles.fill}>
      <div className={styles.mapWrap}>
        <DemoMap
          destination={related}
          primary={null}
          alternate={null}
          ghost={null}
          marks={[item]}
          hotId={item.id}
          traveling={false}
        />
        <div className={styles.floatBar}>
          <button className={styles.floatButton} type="button" onClick={onBack}>
            <ChevronLeft size={18} aria-hidden="true" />
            Closures
          </button>
          <span className={styles.samplePill}>Sample</span>
        </div>
      </div>
      <section className={cx(styles.sheet, styles.sheetIn)}>
        <div className={styles.handle} aria-hidden="true" />
        <span className={cx(styles.kind, item.sidewalk === "open" && styles.kindOpen)}>{item.kind}</span>
        <h2 id={active ? "demo-screen-heading" : undefined} tabIndex={active ? -1 : undefined} className={styles.detailLead}>
          {item.title}
        </h2>
        <p className={styles.lede}>{item.where}</p>
        <p className={styles.bodyCopy}>{item.blurb}</p>
        <div className={cx(styles.banner, item.sidewalk === "open" ? styles.bannerInfo : undefined)}>
          {item.sidewalk === "open" ? <Info size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
          <span>
            Blocks {item.blocks.toLowerCase()}. Sidewalks are {item.sidewalk} in this sample. {item.until}.
          </span>
        </div>
        <div className={styles.sheetAction}>
          <button className={cx(styles.submit, styles.hint)} type="button" onClick={onPlanAround}>
            Plan around this
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.fine}>Sample permit, not a live closure.</p>
      </section>
    </div>
  );
}
