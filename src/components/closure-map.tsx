"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map,
  setWorkerUrl,
  AttributionControl,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
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

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
const empty = { type: "FeatureCollection" as const, features: [] };
type Props = {
  features: ClosureFeature[];
  selected: ClosureFeature | null;
  onSelect: (id: string) => void;
  onBounds: (bounds: number[]) => void;
  fitRequest: number;
};

export function ClosureMap({
  features,
  selected,
  onSelect,
  onBounds,
  fitRequest,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const props = useRef({ features, onSelect, onBounds });
  useEffect(() => {
    props.current = { features, onSelect, onBounds };
  }, [features, onSelect, onBounds]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locating, setLocating] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    try {
      map = new Map({
        container: container.current,
        style: "/map-style.json",
        center: [-73.985, 40.735],
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
      map.addSource("location", { type: "geojson", data: empty });
      map.addLayer({
        id: "user-location",
        type: "circle",
        source: "location",
        paint: {
          "circle-radius": 8,
          "circle-color": "#326448",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 3,
        },
      });
      setError("");
      setReady(true);
      reportBounds();
    });
    map.on("moveend", reportBounds);
    map.on("click", (e) => {
      if (!map.getLayer("closure-lines")) return;
      const found = map.queryRenderedFeatures(
        [
          [e.point.x - 7, e.point.y - 7],
          [e.point.x + 7, e.point.y + 7],
        ],
        { layers: ["closure-lines", "closure-points"] },
      );
      if (found[0]) props.current.onSelect(String(found[0].properties.id));
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
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (ready)
      (
        mapRef.current?.getSource("closures") as GeoJSONSource | undefined
      )?.setData({ type: "FeatureCollection", features });
  }, [features, ready]);
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

  const locate = () => {
    if (!navigator.geolocation) {
      setNotice("Location is unavailable in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const { longitude: lng, latitude: lat } = coords;
        if (lng < -74.3 || lng > -73.65 || lat < 40.45 || lat > 40.95) {
          setNotice(
            "You’re outside NYC. This map currently covers the five boroughs.",
          );
          return;
        }
        setNotice("");
        (mapRef.current?.getSource("location") as GeoJSONSource)?.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [lng, lat] },
        });
        mapRef.current?.jumpTo({ center: [lng, lat], zoom: 15 });
      },
      () => {
        setLocating(false);
        setNotice(
          "Location wasn’t available. Allow location access in your browser, or explore the map manually.",
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
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
          aria-label="Reset map to Manhattan"
          disabled={!ready}
          onClick={() =>
            mapRef.current?.jumpTo({
              center: [-73.985, 40.735],
              zoom: 12.1,
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
