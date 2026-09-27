import { z } from "zod";
import type { EventSummary, EventSummaryInput } from "./types";

const impact = z.enum([
  "fully-closed",
  "partially-closed",
  "crowded",
  "likely-open",
  "uncertain",
]);

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\n\r*_#`]/.test(value), "Plain text only");

export const eventSummaryInputSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().min(1).max(180),
    category: z.string().min(1).max(100),
    borough: z.string().min(1).max(60),
    location: z.string().min(1).max(240),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    eventStart: z.number().int().nonnegative().nullable(),
    eventEnd: z.number().int().nonnegative().nullable(),
    permitStatus: z.string().max(80),
    pedestrianImpact: z.enum(["unknown", "blocked", "open"]),
    vehicleImpact: z.enum(["unknown", "blocked", "clear"]).optional(),
  })
  .strict()
  .refine((value) => value.end >= value.start, "Invalid event window");

export const geminiEventSummarySchema = z
  .object({
    tags: z.array(shortText(28)).min(1).max(2),
    keywords: z.array(shortText(24)).max(5),
    facts: z.array(shortText(120)).max(3),
    roadImpact: impact,
    pedestrianImpact: impact,
    confidence: z.enum(["low", "medium", "high"]),
    roadReason: shortText(120),
    pedestrianReason: shortText(120),
  })
  .strict();

function numericTokens(value: string) {
  return value.match(/\b\d+(?:\.\d+)?\b/g) || [];
}

function hasUnsupportedNumbers(summary: unknown, input: EventSummaryInput) {
  const timeStrings = [
    input.start,
    input.end,
    input.eventStart,
    input.eventEnd,
  ]
    .filter((value): value is number => value !== null)
    .map((value) => new Date(value).toISOString());
  const allowed = new Set(
    numericTokens(JSON.stringify({ input, timeStrings })).map((token) =>
      Number(token),
    ),
  );
  return numericTokens(JSON.stringify(summary)).some(
    (token) => !allowed.has(Number(token)),
  );
}

function sourceImpact(
  value: "unknown" | "blocked" | "open" | "clear" | undefined,
): EventSummary["roadImpact"] {
  if (value === "blocked") return "fully-closed";
  if (value === "open" || value === "clear") return "likely-open";
  return "uncertain";
}

export function fallbackEventSummary(input: EventSummaryInput): EventSummary {
  const tags = [...new Set([input.category, input.borough])]
    .map((value) => value.trim().slice(0, 28))
    .filter(Boolean)
    .slice(0, 2);
  const roadImpact = sourceImpact(input.vehicleImpact);
  const pedestrianImpact = sourceImpact(input.pedestrianImpact);
  return {
    tags: tags.length ? tags : ["Street event"],
    keywords: [],
    facts: [],
    roadImpact,
    pedestrianImpact,
    confidence:
      roadImpact === "uncertain" && pedestrianImpact === "uncertain"
        ? "low"
        : "high",
    roadReason:
      roadImpact === "uncertain"
        ? "The official event record does not confirm current vehicle access."
        : "This assessment comes directly from the official closure type.",
    pedestrianReason:
      pedestrianImpact === "uncertain"
        ? "The official event record does not confirm sidewalk access."
        : "This assessment comes directly from the official closure type.",
    provider: "source",
  };
}

export function parseGeminiEventSummary(
  value: unknown,
  input: EventSummaryInput,
): EventSummary | null {
  const parsed = geminiEventSummarySchema.safeParse(value);
  if (!parsed.success || hasUnsupportedNumbers(parsed.data, input)) return null;
  return {
    ...parsed.data,
    tags: [...new Set(parsed.data.tags)].slice(0, 2),
    keywords: [...new Set(parsed.data.keywords)].slice(0, 5),
    provider: "gemini",
  };
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export async function generateEventSummary(
  input: EventSummaryInput,
  options: {
    key?: string;
    model?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<EventSummary> {
  const fallback = fallbackEventSummary(input);
  const key = options.key ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  if (!key) return fallback;

  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    "Create a compact NYC event brief from only the JSON facts below.",
                    "Return JSON only. No markdown, prose intro, advice, hype, or filler.",
                    "tags: 1-2 useful card labels. keywords: up to 5 short discovery terms.",
                    "facts: up to 3 short, non-redundant facts useful before traveling.",
                    "Assess roads and pedestrians cautiously. An inference may use likely/partial/crowded with low confidence, but never present an inference as confirmed.",
                    "Use uncertain when the supplied facts do not support a conclusion.",
                    "Never invent attendance, traffic, amenities, accessibility, venue details, or numbers.",
                    JSON.stringify(input),
                  ].join("\n"),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 320,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              required: [
                "tags",
                "keywords",
                "facts",
                "roadImpact",
                "pedestrianImpact",
                "confidence",
                "roadReason",
                "pedestrianReason",
              ],
              properties: {
                tags: {
                  type: "ARRAY",
                  minItems: 1,
                  maxItems: 2,
                  items: { type: "STRING" },
                },
                keywords: {
                  type: "ARRAY",
                  maxItems: 5,
                  items: { type: "STRING" },
                },
                facts: {
                  type: "ARRAY",
                  maxItems: 3,
                  items: { type: "STRING" },
                },
                roadImpact: {
                  type: "STRING",
                  enum: impact.options,
                },
                pedestrianImpact: {
                  type: "STRING",
                  enum: impact.options,
                },
                confidence: {
                  type: "STRING",
                  enum: ["low", "medium", "high"],
                },
                roadReason: { type: "STRING" },
                pedestrianReason: { type: "STRING" },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
    if (!response.ok) return fallback;
    const body = (await response.json()) as GeminiResponse;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return fallback;
    return parseGeminiEventSummary(JSON.parse(text), input) ?? fallback;
  } catch {
    return fallback;
  }
}
