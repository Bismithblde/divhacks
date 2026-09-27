"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  setWorkerUrl,
  AttributionControl,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import type { AllPaintProperties } from "@maplibre/maplibre-gl-style-spec";
import {
  Plus,
  Minus,
  LocateFixed,
  Maximize,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import type { ClosureFeature } from "@/lib/closures/types";
import { geometryBounds } from "@/lib/closures/normalize";
import type {
  Coordinate,
  RouteFeature,
  RouteMapLine,
} from "@/lib/routing/types";
import { DEMO_LOCATION } from "@/lib/location";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const originalMapPaint = new WeakMap<
  Map,
  globalThis.Map<string, unknown>
>();

function paintForTheme(
  map: Map,
  layer: string,
  property: keyof AllPaintProperties,
  darkValue: unknown,
  dark: boolean,
) {
  if (!map.getLayer(layer)) return;
  let stored = originalMapPaint.get(map);
  if (!stored) {
    stored = new globalThis.Map<string, unknown>();
    originalMapPaint.set(map, stored);
  }
  const key = `${layer}:${property}`;
  if (!stored.has(key)) stored.set(key, map.getPaintProperty(layer, property));
  map.setPaintProperty(
    layer,
    property,
    (dark ? darkValue : stored.get(key)) as AllPaintProperties[typeof property],
  );
}

function applyMapTheme(map: Map, dark: boolean) {
  const fills: Array<[string, string]> = [
    ["background", "#161616"],
    ["park", "#1a3328"],
    ["water", "#1a2830"],
    ["landuse_residential", "#222220"],
    ["landcover_wood", "#1a3328"],
    ["building", "#2a2a28"],
  ];
  for (const [layer, color] of fills) {
    const property = layer === "background" ? "background-color" : "fill-color";
    paintForTheme(map, layer, property, color, dark);
  }
  paintForTheme(map, "building", "fill-outline-color", "#333330", dark);
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "line") continue;
    if (
      !/^(highway|tunnel|aeroway|railway|road_|waterway|boundary)/.test(
        layer.id,
      )
    ) {
      continue;
    }
    const casing = layer.id.includes("casing");
    paintForTheme(
      map,
      layer.id,
      "line-color",
      casing ? "#2a2a2a" : "#5c5c5c",
      dark,
    );
  }
  paintForTheme(map, "closure-casing", "line-color", "#111111", dark);
  paintForTheme(map, "selection-line", "line-color", "#f3f3f3", dark);
  paintForTheme(map, "selection-point", "circle-color", "#f3f3f3", dark);
  paintForTheme(map, "selection-point", "circle-stroke-color", "#111111", dark);
  paintForTheme(map, "destination-point", "circle-color", "#f3f3f3", dark);
  paintForTheme(map, "destination-point", "circle-stroke-color", "#111111", dark);
  paintForTheme(map, "route-casing", "line-color", "#111111", dark);
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    if (map.getPaintProperty(layer.id, "text-color") !== undefined) {
      paintForTheme(map, layer.id, "text-color", "#e4e4e4", dark);
    }
    if (map.getPaintProperty(layer.id, "text-halo-color") !== undefined) {
      paintForTheme(map, layer.id, "text-halo-color", "#161616", dark);
    }
  }
}
const DEFAULT_MAP_CENTER: [number, number] = [
  DEMO_LOCATION.longitude,
  DEMO_LOCATION.latitude,
];
const empty = { type: "FeatureCollection" as const, features: [] };
const emptyPolygons = {
  type: "FeatureCollection" as const,
  features: [],
};
const EARTH_RADIUS_METERS = 6_371_008.8;
const LOCATION_CONE_RADIUS_METERS = 75;
const LOCATION_CONE_FOV_DEGREES = 52;
const LOCATION_CIRCLE_POINTS = 48;

type UserLocation = {
  longitude: number;
  latitude: number;
  accuracy: number;
};

type DeviceOrientationWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number | null;
};

function destination(
  longitude: number,
  latitude: number,
  distanceMeters: number,
  bearingDegrees: number,
): [number, number] {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const lng = (longitude * Math.PI) / 180;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(angularDistance) +
      Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLng =
    lng +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
      Math.cos(angularDistance) - Math.sin(lat) * Math.sin(nextLat),
    );
  return [(nextLng * 180) / Math.PI, (nextLat * 180) / Math.PI];
}

function circleFeature(location: UserLocation, radiusMeters: number) {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= LOCATION_CIRCLE_POINTS; i += 1) {
    coordinates.push(
      destination(
        location.longitude,
        location.latitude,
        radiusMeters,
        (i / LOCATION_CIRCLE_POINTS) * 360,
      ),
    );
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [coordinates] },
  };
}

function coneFeature(
  location: UserLocation,
  heading: number,
  radiusMeters: number,
  fieldOfViewDegrees: number,
) {
  const coordinates: [number, number][] = [
    [location.longitude, location.latitude],
  ];
  const start = heading - fieldOfViewDegrees / 2;
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    coordinates.push(
      destination(
        location.longitude,
        location.latitude,
        radiusMeters,
        start + (i / steps) * fieldOfViewDegrees,
      ),
    );
  }
  coordinates.push([location.longitude, location.latitude]);
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [coordinates] },
  };
}

type Props = {
  features: ClosureFeature[];
  selected: ClosureFeature | null;
  route: RouteFeature | null;
  routeLines?: RouteMapLine[];
  routeLabel: {
    durationSeconds: number;
    modeLabel: string;
  } | null;
  destination: Coordinate | null;
  selectingDestination: boolean;
  onSelect: (id: string) => void;
  onDestination: (coordinate: Coordinate) => void;
  onBounds: (bounds: number[]) => void;
  fitRequest: number;
};

export function ClosureMap({
  features,
  selected,
  route,
  routeLines = [],
  routeLabel,
  destination,
  selectingDestination,
  onSelect,
  onDestination,
  onBounds,
  fitRequest,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const routeLabelMarker = useRef<Marker | null>(null);
  const currentLocation = useRef<UserLocation | null>(null);
  const heading = useRef<number | null>(null);
  const watchId = useRef<number | null>(null);
  const orientationCleanup = useRef<(() => void) | null>(null);
  const orientationAvailable = useRef<boolean | null>(null);
  const centeredOnLocation = useRef(false);
  const props = useRef({
    features,
    routeLines,
    onSelect,
    onDestination,
    onBounds,
    selectingDestination,
  });
  useEffect(() => {
    props.current = {
      features,
      routeLines,
      onSelect,
      onDestination,
      onBounds,
      selectingDestination,
    };
  }, [
    features,
    routeLines,
    onSelect,
    onDestination,
    onBounds,
    selectingDestination,
  ]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationVisible, setLocationVisible] = useState(false);
  const [locationIsDemo, setLocationIsDemo] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const updateLocationLayers = useCallback(() => {
    const map = mapRef.current;
    const location = currentLocation.current;
    if (!map) return;
    if (!location) {
      (map.getSource("location") as GeoJSONSource | undefined)?.setData(empty);
      (
        map.getSource("location-accuracy") as GeoJSONSource | undefined
      )?.setData(emptyPolygons);
      (
        map.getSource("location-cone") as GeoJSONSource | undefined
      )?.setData(emptyPolygons);
      return;
    }

    (map.getSource("location") as GeoJSONSource | undefined)?.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: [location.longitude, location.latitude],
      },
    });
    (
      map.getSource("location-accuracy") as GeoJSONSource | undefined
    )?.setData(circleFeature(location, Math.min(location.accuracy, 200)));
    (
      map.getSource("location-cone") as GeoJSONSource | undefined
    )?.setData(
      heading.current === null
        ? emptyPolygons
        : coneFeature(
            location,
            heading.current,
            LOCATION_CONE_RADIUS_METERS,
            LOCATION_CONE_FOV_DEGREES,
          ),
    );
  }, []);

  const setDemoLocation = useCallback(
    (message: string) => {
      currentLocation.current = DEMO_LOCATION;
      setLocationVisible(true);
      setLocationIsDemo(true);
      updateLocationLayers();
      if (!centeredOnLocation.current) {
        centeredOnLocation.current = true;
        mapRef.current?.jumpTo({
          center: DEFAULT_MAP_CENTER,
          zoom: 14.5,
        });
      }
      setNotice(message);
    },
    [updateLocationLayers],
  );

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    try {
      map = new Map({
        container: container.current,
        style: "/map-style.json",
        center: DEFAULT_MAP_CENTER,
        zoom: 12.1,
        minZoom: 9,
        maxZoom: 19,
        maxBounds: [
          [-74.35, 40.43],
          [-73.6, 40.99],
        ],
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      queueMicrotask(() =>
        setError(
          "Your browser couldn’t start the map. Enable WebGL or use the closure list.",
        ),
      );
      return;
    }
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: false }), "bottom-right");
    map.addControl(
      new ScaleControl({ unit: "imperial", maxWidth: 100 }),
      "bottom-left",
    );
    const reportBounds = () => {
      const b = map.getBounds();
      props.current.onBounds([
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]);
    };
    const timer = setTimeout(() => {
      if (!map.isStyleLoaded())
        setError(
          "The basemap is taking longer than expected. Check your connection or retry.",
        );
    }, 20_000);
    map.on("load", () => {
      clearTimeout(timer);
      map.addSource("closures", {
        type: "geojson",
        data: { type: "FeatureCollection", features: props.current.features },
        promoteId: "id",
        tolerance: 0.5,
        maxzoom: 16,
      });
      const color: ExpressionSpecification = [
        "match",
        ["get", "kind"],
        "event",
        "#55436D",
        "#873C38",
      ];
      map.addLayer({
        id: "closure-casing",
        type: "line",
        source: "closures",
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            3,
            14,
            8,
            18,
            12,
          ],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "closure-lines",
        type: "line",
        source: "closures",
        filter: ["!=", ["geometry-type"], "Point"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": color,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            1.5,
            14,
            4,
            18,
            7,
          ],
        },
      });
      map.addLayer({
        id: "closure-points",
        type: "circle",
        source: "closures",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#F8DEDC",
          "circle-stroke-color": "#873C38",
          "circle-stroke-width": 2,
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            2,
            14,
            5,
            18,
            7,
          ],
        },
      });
      map.addSource("selection", { type: "geojson", data: empty });
      map.addLayer({
        id: "selection-casing",
        type: "line",
        source: "selection",
        paint: { "line-color": "#fff", "line-width": 12 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "selection-line",
        type: "line",
        source: "selection",
        paint: { "line-color": "#181818", "line-width": 6 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "selection-point",
        type: "circle",
        source: "selection",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#181818",
          "circle-radius": 8,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
      map.addSource("route", { type: "geojson", data: empty });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        paint: { "line-color": "#ffffff", "line-width": 10 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#326448", "line-width": 5 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource("route-options", { type: "geojson", data: empty });
      map.addLayer({
        id: "route-options-casing",
        type: "line",
        source: "route-options",
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            10,
            6,
          ],
          "line-opacity": 0.95,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "route-options-line",
        type: "line",
        source: "route-options",
        paint: {
          "line-color": [
            "match",
            ["get", "mode"],
            "BUS",
            "#B45309",
            "SUBWAY",
            "#7C3AED",
            "DRIVE",
            "#2563EB",
            "#326448",
          ],
          "line-width": [
            "case",
            ["boolean", ["get", "selected"], false],
            6,
            3,
          ],
          "line-opacity": [
            "case",
            ["boolean", ["get", "selected"], false],
            1,
            0.55,
          ],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource("destination", { type: "geojson", data: empty });
      map.addLayer({
        id: "destination-point",
        type: "circle",
        source: "destination",
        paint: {
          "circle-color": "#181818",
          "circle-radius": 8,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });
      map.addSource("location", { type: "geojson", data: empty });
      map.addSource("location-accuracy", {
        type: "geojson",
        data: emptyPolygons,
      });
      map.addLayer({
        id: "user-location-accuracy",
        type: "fill",
        source: "location-accuracy",
        paint: {
          "fill-color": "#2563EB",
          "fill-opacity": 0.12,
          "fill-outline-color": "#2563EB",
        },
      });
      map.addSource("location-cone", {
        type: "geojson",
        data: emptyPolygons,
      });
      map.addLayer({
        id: "user-location-cone",
        type: "fill",
        source: "location-cone",
        paint: {
          "fill-color": "#2563EB",
          "fill-opacity": 0.2,
          "fill-outline-color": "#2563EB",
        },
      });
      map.addLayer({
        id: "user-location",
        type: "circle",
        source: "location",
        paint: {
          "circle-radius": 8,
          "circle-color": "#2563EB",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
      setError("");
      setReady(true);
      updateLocationLayers();
      reportBounds();
    });
    map.on("moveend", reportBounds);
    map.on("click", (e) => {
      if (!map.getLayer("closure-lines")) return;
      if (props.current.selectingDestination) {
        props.current.onDestination([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const found = map.queryRenderedFeatures(
        [
          [e.point.x - 40, e.point.y - 40],
          [e.point.x + 40, e.point.y + 40],
        ],
        { layers: ["closure-lines", "closure-points"] },
      );
      if (found[0]) {
        props.current.onSelect(String(found[0].properties.id));
      } else {
        props.current.onDestination([e.lngLat.lng, e.lngLat.lat]);
      }
    });
    map.on("mousemove", (e) => {
      if (map.getLayer("closure-lines"))
        map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, {
          layers: ["closure-lines", "closure-points"],
        }).length
          ? "pointer"
          : "";
    });
    map.on("error", () => {
      if (map.isStyleLoaded())
        setNotice(
          "Some map tiles couldn’t load. Closure information is still available in the list.",
        );
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      routeLabelMarker.current?.remove();
      routeLabelMarker.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [attempt, updateLocationLayers]);

  useEffect(() => {
    return () => {
      if (watchId.current !== null && "geolocation" in navigator)
        navigator.geolocation.clearWatch(watchId.current);
      orientationCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const apply = () =>
      applyMapTheme(map, document.documentElement.dataset.theme === "dark");
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    if (ready)
      (
        mapRef.current?.getSource("closures") as GeoJSONSource | undefined
      )?.setData({ type: "FeatureCollection", features });
  }, [features, ready]);
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource("route") as GeoJSONSource | undefined)?.setData(
      route || empty,
    );
  }, [route, ready]);
  useEffect(() => {
    if (!ready) return;
    const features = routeLines.map((line) => ({
      ...line.route,
      properties: {
        ...line.route.properties,
        routeId: line.id,
        mode: line.mode,
        selected: Boolean(line.selected),
      },
    }));
    (
      mapRef.current?.getSource("route-options") as GeoJSONSource | undefined
    )?.setData({ type: "FeatureCollection", features });
  }, [ready, routeLines]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    if (!route || !routeLabel || route.geometry.coordinates.length === 0) {
      routeLabelMarker.current?.remove();
      routeLabelMarker.current = null;
      return;
    }

    const coordinates = route.geometry.coordinates;
    const position = coordinates[Math.floor(coordinates.length / 2)] as Coordinate;
    let marker = routeLabelMarker.current;

    if (!marker) {
      const element = document.createElement("div");
      element.className = "route-map-pill";
      element.setAttribute("aria-hidden", "true");
      marker = new Marker({
        element,
        anchor: "bottom",
        offset: [0, -8],
      })
        .setLngLat(position)
        .addTo(map);
      routeLabelMarker.current = marker;
    }

    const element = marker.getElement();
    element.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = `${Math.max(1, Math.round(routeLabel.durationSeconds / 60))} min`;
    const span = document.createElement("span");
    span.textContent = `${routeLabel.modeLabel} estimate`;
    element.append(strong, span);
    marker.setLngLat(position);
  }, [ready, route, routeLabel]);
  useEffect(() => {
    if (!ready) return;
    (
      mapRef.current?.getSource("destination") as GeoJSONSource | undefined
    )?.setData(
      destination
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: destination },
          }
        : empty,
    );
  }, [destination, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("selection") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: selected ? [selected] : [],
    });
    if (selected) {
      const [w, s, e, n] = geometryBounds(selected.geometry);
      map.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        {
          padding: 70,
          maxZoom: 15.5,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 500,
        },
      );
    }
  }, [selected, ready]);
  useEffect(() => {
    if (
      !fitRequest ||
      !mapRef.current ||
      !ready ||
      !props.current.features.length
    )
      return;
    const bounds = props.current.features.map((f) =>
      geometryBounds(f.geometry),
    );
    mapRef.current.fitBounds(
      [
        [
          Math.min(...bounds.map((b) => b[0])),
          Math.min(...bounds.map((b) => b[1])),
        ],
        [
          Math.max(...bounds.map((b) => b[2])),
          Math.max(...bounds.map((b) => b[3])),
        ],
      ],
      { padding: 48, maxZoom: 14, duration: 0 },
    );
  }, [fitRequest, ready]);

  const enableOrientation = useCallback(async () => {
    const OrientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (!OrientationEvent) {
      orientationAvailable.current = false;
      return;
    }

    try {
      if (OrientationEvent.requestPermission) {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== "granted") {
          orientationAvailable.current = false;
          return;
        }
      }
      orientationAvailable.current = true;
    } catch {
      orientationAvailable.current = false;
      return;
    }

    if (orientationCleanup.current) return;
    const onOrientation = (event: Event) => {
      const device = event as DeviceOrientationWithCompass;
      const compassHeading = device.webkitCompassHeading;
      let nextHeading =
        typeof compassHeading === "number" && Number.isFinite(compassHeading)
          ? compassHeading
          : null;

      if (nextHeading === null && device.absolute && device.alpha !== null) {
        const screenAngle =
          typeof screen.orientation?.angle === "number"
            ? screen.orientation.angle
            : 0;
        nextHeading = 360 - device.alpha + screenAngle;
      }
      if (nextHeading === null || !Number.isFinite(nextHeading)) return;
      heading.current = ((nextHeading % 360) + 360) % 360;
      updateLocationLayers();
    };

    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    orientationCleanup.current = () => {
      window.removeEventListener(
        "deviceorientationabsolute",
        onOrientation,
        true,
      );
      window.removeEventListener("deviceorientation", onOrientation, true);
      orientationCleanup.current = null;
    };
  }, [updateLocationLayers]);

  const requestLocation = useCallback(
    async (requestOrientation: boolean) => {
      if (!navigator.geolocation) {
        setDemoLocation(
          "Location access is unavailable in this browser. You can still browse NYC disruptions.",
        );
        return;
      }
      if (requestOrientation) await enableOrientation();
      if (currentLocation.current) {
        mapRef.current?.jumpTo({
          center: [
            currentLocation.current.longitude,
            currentLocation.current.latitude,
          ],
          zoom: 15,
        });
        return;
      }
      if (watchId.current !== null) return;
      setLocating(true);
      watchId.current = navigator.geolocation.watchPosition(
        ({ coords }) => {
          setLocating(false);
          const { longitude: lng, latitude: lat } = coords;
          if (lng < -74.3 || lng > -73.65 || lat < 40.45 || lat > 40.95) {
            currentLocation.current = null;
            setLocationVisible(false);
            updateLocationLayers();
            setNotice(
              "You’re outside NYC. This map currently covers the five boroughs.",
            );
            return;
          }
          currentLocation.current = {
            longitude: lng,
            latitude: lat,
            accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : 25,
          };
          setLocationVisible(true);
          setLocationIsDemo(false);
          updateLocationLayers();
          if (!centeredOnLocation.current) {
            centeredOnLocation.current = true;
            mapRef.current?.jumpTo({ center: [lng, lat], zoom: 15 });
          }
          setNotice(
            orientationAvailable.current === false
              ? "Your location is shown, but device orientation is unavailable."
              : "",
          );
        },
        (error) => {
          setLocating(false);
          setLocationVisible(false);
          if (watchId.current !== null)
            navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          setDemoLocation(
            error.code === 1
              ? "Location access was denied. Enable it to center the map on you."
              : "Your location is unavailable. You can still browse NYC disruptions.",
          );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
      );
    },
    [enableOrientation, updateLocationLayers, setDemoLocation],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void requestLocation(false), 0);
    return () => window.clearTimeout(timer);
  }, [ready, requestLocation]);

  const locate = () => {
    void requestLocation(true);
  };

  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        aria-label="Interactive NYC closure map"
        role="region"
        data-testid="closure-map"
        data-ready={ready}
        data-feature-count={features.length}
        data-location-visible={locationVisible}
        data-location-demo={locationIsDemo}
      />
      {!ready && !error && (
        <div className="map-loading" role="status">
          Loading the NYC map…
        </div>
      )}
      {error && (
        <div className="map-message" role="alert">
          <AlertTriangle size={20} />
          <p>{error}</p>
          <button
            className="button secondary"
            onClick={() => {
              setReady(false);
              setError("");
              setAttempt((a) => a + 1);
            }}
          >
            Retry map
          </button>
        </div>
      )}
      {notice && (
        <div className="map-notice" role="status">
          <p>{notice}</p>
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      <div className="map-tools" aria-label="Map controls">
        <div className="tool-group">
          <button
            aria-label="Zoom in"
            disabled={!ready}
            onClick={() => mapRef.current?.zoomIn()}
          >
            <Plus size={20} />
          </button>
          <button
            aria-label="Zoom out"
            disabled={!ready}
            onClick={() => mapRef.current?.zoomOut()}
          >
            <Minus size={20} />
          </button>
        </div>
        <button
          className="map-tool"
          aria-label="Show my location"
          disabled={!ready || locating}
          onClick={locate}
        >
          <LocateFixed size={20} className={locating ? "spin" : ""} />
        </button>
        <button
          className="map-tool"
          aria-label="Reset map to NYC overview"
          disabled={!ready}
          onClick={() =>
            mapRef.current?.jumpTo({
              center: DEFAULT_MAP_CENTER,
              zoom: 14.5,
              bearing: 0,
              pitch: 0,
            })
          }
        >
          <RotateCcw size={19} />
        </button>
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-line event" />
          Event
        </span>
        <span>
          <i className="legend-line construction" />
          Construction
        </span>
        <span>
          <i className="legend-point" />
          Intersection
        </span>
      </div>
      <button
        className="fit-map"
        aria-label="Show all filtered closures on map"
        disabled={!ready || !features.length}
        onClick={() => {
          const bs = features.map((f) => geometryBounds(f.geometry));
          mapRef.current?.fitBounds(
            [
              [
                Math.min(...bs.map((b) => b[0])),
                Math.min(...bs.map((b) => b[1])),
              ],
              [
                Math.max(...bs.map((b) => b[2])),
                Math.max(...bs.map((b) => b[3])),
              ],
            ],
            { padding: 48, maxZoom: 14, duration: 0 },
          );
        }}
      >
        <Maximize size={15} /> Show all closures
      </button>
    </>
  );
}
