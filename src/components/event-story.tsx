"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Car,
  Footprints,
  Info,
  Sparkles,
} from "lucide-react";
import type { ClosureFeature } from "@/lib/closures/types";
import {
  sourceEventTags,
  type EventAccessOverride,
  type EventSummary,
  type EventSummaryInput,
} from "@/lib/events/types";

const dateTime = (value: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

const impactLabel = {
  "fully-closed": "Likely fully closed",
  "partially-closed": "Possible partial closure",
  crowded: "Likely crowded",
  "likely-open": "Likely open",
  uncertain: "Unclear",
} as const;

function summaryInput(feature: ClosureFeature): EventSummaryInput {
  const p = feature.properties;
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    borough: p.borough,
    location: p.location,
    start: p.start,
    end: p.end,
    eventStart: p.eventStart,
    eventEnd: p.eventEnd,
    permitStatus: p.permitStatus,
    pedestrianImpact: p.pedestrianImpact,
    vehicleImpact: p.vehicleImpact,
  };
}

export function EventStory({
  feature,
  summary,
  override,
  onBack,
  onSources,
  onSummary,
  onOverride,
}: {
  feature: ClosureFeature;
  summary?: EventSummary;
  override?: EventAccessOverride;
  onBack: () => void;
  onSources: () => void;
  onSummary: (id: string, summary: EventSummary) => void;
  onOverride: (id: string, override: EventAccessOverride | null) => void;
}) {
  const [failedSummaryId, setFailedSummaryId] = useState("");
  const p = feature.properties;
  const loading = !summary && failedSummaryId !== p.id;
  const summaryError =
    failedSummaryId === p.id ? "Summary unavailable" : "";

  useEffect(() => {
    if (summary) return;
    const controller = new AbortController();
    void fetch("/api/events/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summaryInput(feature)),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Summary unavailable");
        return (await response.json()) as EventSummary;
      })
      .then((result) => onSummary(p.id, result))
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailedSummaryId(p.id);
        }
      });
    return () => controller.abort();
  }, [feature, onSummary, p.id, summary]);

  const tags = summary?.tags.length ? summary.tags : sourceEventTags(feature);
  const hasDistinctEventWindow =
    p.eventStart !== null &&
    p.eventEnd !== null &&
    (p.eventStart !== p.start || p.eventEnd !== p.end);

  return (
    <>
      <div className="panel-heading detail-heading event-story-heading">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={18} /> All closures
        </button>
        <span className="detail-type event">
          <Sparkles size={15} /> NYC event
        </span>
        <h1>{p.title}</h1>
        <div className="event-tag-list" aria-label="Event tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="panel-scroll detail-content event-story">
        <section className="event-story-section" aria-labelledby="event-timing">
          <h2 id="event-timing">Timing</h2>
          <div className="event-time-grid">
            {p.eventStart !== null && p.eventEnd !== null ? (
              <div>
                <span>Public event</span>
                <strong>
                  {dateTime(p.eventStart)}–{dateTime(p.eventEnd)}
                </strong>
              </div>
            ) : (
              <div>
                <span>Public event</span>
                <strong>Not separately listed</strong>
              </div>
            )}
            <div>
              <span>Street impact window</span>
              <strong>
                {dateTime(p.start)}–{dateTime(p.end)}
              </strong>
              {hasDistinctEventWindow && (
                <small>Includes setup or breakdown time</small>
              )}
            </div>
          </div>
        </section>

        <section className="event-story-section" aria-labelledby="event-brief">
          <div className="event-story-title-row">
            <h2 id="event-brief">Event brief</h2>
            <span>{summary?.provider === "gemini" ? "Gemini · grounded" : "Source facts"}</span>
          </div>
          {loading && <p className="event-summary-status">Checking event details…</p>}
          {summaryError && (
            <p className="event-summary-status">
              AI brief unavailable. Official source facts are still shown.
            </p>
          )}
          {summary?.keywords.length ? (
            <div className="event-keywords" aria-label="Keywords">
              {summary.keywords.map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </div>
          ) : null}
          {summary?.facts.length ? (
            <ul className="event-facts">
              {summary.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          ) : (
            !loading && (
              <p className="event-summary-status">
                No additional verified event facts are available.
              </p>
            )
          )}
          <div className="event-impact-grid">
            <div>
              <Car size={17} aria-hidden="true" />
              <span>Roads</span>
              <strong>
                {summary ? impactLabel[summary.roadImpact] : "Unclear"}
              </strong>
              <small>
                {summary?.roadReason ||
                  "The official record does not confirm current road access."}
              </small>
            </div>
            <div>
              <Footprints size={17} aria-hidden="true" />
              <span>Sidewalks</span>
              <strong>
                {summary ? impactLabel[summary.pedestrianImpact] : "Unclear"}
              </strong>
              <small>
                {summary?.pedestrianReason ||
                  "The official record does not confirm sidewalk access."}
              </small>
            </div>
          </div>
          <p className="event-ai-caveat">
            AI assessment, not street-level confirmation. Check the official
            source before relying on access.
          </p>
        </section>

        <section className="event-story-section event-override" aria-labelledby="event-access">
          <h2 id="event-access">What are you seeing?</h2>
          <p>
            Adjust routing for this session only. Your report is not published
            or shared.
          </p>
          <label htmlFor={`event-access-${p.id}`}>Routing assumption</label>
          <select
            id={`event-access-${p.id}`}
            value={override || ""}
            onChange={(event) =>
              onOverride(
                p.id,
                (event.target.value as EventAccessOverride) || null,
              )
            }
          >
            <option value="">Use official schedule (conservative)</option>
            <option value="no-closure">No closure observed</option>
            <option value="roads-closed">Road closed; sidewalk passable</option>
            <option value="sidewalk-closed">Sidewalk closed; road passable</option>
            <option value="sidewalk-crowded">Sidewalk crowded but passable</option>
          </select>
          {override && (
            <p className="event-override-active" role="status">
              Session-only override active. Re-run the route to apply it.
            </p>
          )}
        </section>

        <div className="info-note">
          <Info size={19} />
          <div>
            <strong>Mapped permit footprint</strong>
            <p>
              {p.location} · {p.borough}. A permit footprint does not prove
              every road, sidewalk, or crossing is currently blocked.
            </p>
          </div>
        </div>
        <a
          className="button primary source-link"
          href={p.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          View official source <ArrowUpRight size={17} />
        </a>
        <button className="text-button" onClick={onSources}>
          How we use this data
        </button>
      </div>
    </>
  );
}
