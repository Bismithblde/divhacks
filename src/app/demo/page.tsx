import type { Metadata } from "next";
import { ProductDemo } from "@/components/product-demo";

export const metadata: Metadata = {
  title: "Wrap product demo",
  description:
    "Click through a sample Wrap trip on a phone: pick a place, compare routes around a closure, and choose what to do when the plan changes.",
};

export default function DemoPage() {
  return <ProductDemo />;
}
