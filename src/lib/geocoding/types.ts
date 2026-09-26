import type { Coordinate } from "@/lib/routing/types";

export type GeocodeResult = {
  id: string;
  label: string;
  coordinate: Coordinate;
};

export type GeocodeResponse = {
  results: GeocodeResult[];
  error?: string;
};
