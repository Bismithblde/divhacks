"use client";

import Image from "next/image";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

export function LandingPage() {
  const pageRef = useRef<HTMLElement>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!getSupabaseConfig()) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
    });
  }, []);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    gsap.registerPlugin(ScrollTrigger);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (reducedMotion) {
        return;
      }

      gsap.utils.toArray<HTMLElement>("[data-landing-reveal]").forEach((item) => {
        gsap.fromTo(
          item,
          { autoAlpha: 0, y: 42, filter: "blur(10px)" },
          {
            autoAlpha: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.85,
            ease: "power3.out",
            scrollTrigger: { trigger: item, start: "top 84%", once: true },
          },
        );
      });

      gsap.fromTo(
        "[data-landing-hero]",
        { autoAlpha: 0, y: 36, filter: "blur(8px)" },
        {
          autoAlpha: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.9,
          stagger: 0.12,
          ease: "power3.out",
        },
      );
      gsap.fromTo(
        "[data-landing-art]",
        { autoAlpha: 0, scale: 0.9, y: 38, rotate: 2, filter: "blur(12px)" },
        {
          autoAlpha: 1,
          scale: 1,
          y: 0,
          rotate: 0,
          filter: "blur(0px)",
          duration: 1.15,
          delay: 0.16,
          ease: "power4.out",
        },
      );

      const story = page.querySelector<HTMLElement>(".landing-story");
      if (!story) return;
      const stage = story.querySelector<HTMLElement>(".landing-story-stage");
      const chapters = gsap.utils.toArray<HTMLElement>(".landing-story-chapter", story);
      const panels = gsap.utils.toArray<HTMLElement>(".landing-story-scene", story);
      const canvas = story.querySelector<HTMLElement>(".landing-story-canvas");
      const halo = story.querySelector<SVGCircleElement>(".landing-story-halo");
      const progress = story.querySelector<HTMLElement>(".landing-story-progress-fill");
      const counter = story.querySelector<HTMLElement>(".landing-story-stage-count");
      const traveler = story.querySelector<SVGCircleElement>(".landing-story-traveler");
      const routeIds = ["#story-route-direct", "#story-route-walk", "#story-route-bus"];
      let activeChapter = -1;

      const moveTraveler = (index: number) => {
        if (!traveler) return;
        const path = story.querySelector<SVGPathElement>(routeIds[index]);
        if (!path) return;
        const pathLength = path.getTotalLength();
        const movement = { distance: index === 0 ? pathLength * 0.58 : 0 };
        const updatePosition = () => {
          const point = path.getPointAtLength(movement.distance);
          gsap.set(traveler, { attr: { cx: point.x, cy: point.y } });
        };
        gsap.killTweensOf(movement);
        gsap.set(traveler, { autoAlpha: 1, scale: 1 });
        updatePosition();
        if (index > 0) {
          gsap.to(movement, {
            distance: pathLength * (index === 1 ? 0.98 : 0.74),
            duration: 1.05,
            ease: "power3.inOut",
            onUpdate: updatePosition,
          });
        }
      };

      const showChapter = (index: number) => {
        if (activeChapter === index || !stage) return;
        activeChapter = index;
        stage.dataset.step = String(index + 1);
        if (counter) counter.textContent = `0${index + 1} / 03`;
        chapters.forEach((chapter, chapterIndex) => {
          chapter.toggleAttribute("data-active", chapterIndex === index);
        });
        panels.forEach((panel, panelIndex) => {
          const active = panelIndex === index;
          panel.setAttribute("aria-hidden", String(!active));
          gsap.to(panel, {
            autoAlpha: active ? 1 : 0,
            y: active ? 0 : -18,
            rotateX: active ? 0 : 8,
            scale: active ? 1 : 0.97,
            duration: 0.55,
            ease: "power3.out",
            overwrite: true,
          });
        });
        gsap.to(progress, {
          scaleX: (index + 1) / chapters.length,
          duration: 0.6,
          ease: "power2.out",
        });
        const selectedRoute = story.querySelector<SVGPathElement>(routeIds[index]);
        if (selectedRoute) {
          const pathLength = selectedRoute.getTotalLength();
          gsap.killTweensOf(selectedRoute);
          if (index === 0) {
            gsap.set(selectedRoute, { strokeDashoffset: 38 });
            gsap.to(selectedRoute, { strokeDashoffset: 0, duration: 0.8, ease: "power2.out" });
          } else {
            gsap.set(selectedRoute, {
              strokeDasharray: pathLength,
              strokeDashoffset: pathLength,
            });
            gsap.to(selectedRoute, {
              strokeDashoffset: 0,
              duration: 1.05,
              ease: "power3.inOut",
            });
          }
        }
        if (canvas) {
          gsap.fromTo(
            canvas,
            { scale: 1.08, rotateX: 5, filter: "brightness(0.7) saturate(0.8)" },
            {
              scale: 1,
              rotateX: 0,
              filter: "brightness(1) saturate(1)",
              duration: 1.1,
              ease: "power3.out",
              overwrite: true,
            },
          );
        }
        if (halo) {
          gsap.fromTo(
            halo,
            { scale: 0.55, opacity: 0.9 },
            {
              scale: 2.1,
              opacity: 0,
              duration: 1,
              ease: "power2.out",
              overwrite: true,
              onComplete: () => gsap.set(halo, { scale: 1, opacity: 0.45 }),
            },
          );
        }
        moveTraveler(index);
      };

      chapters.forEach((chapter, index) => {
        ScrollTrigger.create({
          trigger: chapter,
          start: () => window.matchMedia("(max-width: 700px)").matches ? "top 47%" : "top 59%",
          end: () => window.matchMedia("(max-width: 700px)").matches ? "bottom 35%" : "bottom 41%",
          onEnter: () => showChapter(index),
          onEnterBack: () => showChapter(index),
        });
        const copy = chapter.querySelector<HTMLElement>(".landing-story-chapter-copy");
        if (copy) {
          gsap.fromTo(
            copy,
            { y: 48, autoAlpha: 0, filter: "blur(8px)" },
            {
              y: 0,
              autoAlpha: 1,
              filter: "blur(0px)",
              ease: "none",
              scrollTrigger: {
                trigger: chapter,
                start: "top 82%",
                end: "top 53%",
                scrub: 0.6,
              },
            },
          );
        }
      });
      if (stage && chapters.length > 1) {
        gsap.matchMedia().add(
          { desktop: "(min-width: 701px)", mobile: "(max-width: 700px)" },
          (context) => {
            ScrollTrigger.create({
              trigger: stage,
              start: context.conditions?.mobile ? "top top" : "top top+=74",
              endTrigger: chapters[chapters.length - 1],
              end: "bottom bottom",
              pin: stage,
              pinSpacing: false,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            });
          },
        );
      }
    }, page);

    return () => {
      context.revert();
    };
  }, []);

  return (
    <main ref={pageRef} className="landing-page">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="Wrap home">
          <span className="landing-brand-mark" aria-hidden="true">
            <Image
              src="/brand/wrap-light.png"
              alt=""
              width={36}
              height={36}
              className="landing-brand-icon landing-brand-icon-light"
              priority
            />
            <Image
              src="/brand/wrap-dark.png"
              alt=""
              width={36}
              height={36}
              className="landing-brand-icon landing-brand-icon-dark"
              priority
            />
          </span>
          <span>Wrap</span>
        </Link>

        <nav className="landing-nav-links" aria-label="Landing page">
          <a href="#why-wrap">Why Wrap</a>
          <a href="#how-it-works">How it works</a>
        </nav>

        <div className="landing-nav-actions">
          <ThemeToggle />
          {signedIn ? (
            <>
              <Link href="/map" className="landing-sign-in">
                Open map
              </Link>
              <SignOutButton className="button-primary landing-nav-cta" />
            </>
          ) : (
            <>
              <Link href="/auth?mode=signin" className="landing-sign-in">
                Sign in
              </Link>
              <Link href="/auth?mode=signup" className="button-primary landing-nav-cta">
                Get started
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title" data-landing-hero>
            When New York changes, <em>Wrap.</em>
          </h1>
          <p className="landing-hero-description" data-landing-hero>
            One place to plan a walking, bus, or subway trip. If something
            changes, Wrap compares waiting with switching modes and gives you the
            fastest next option.
          </p>
          <div className="landing-hero-actions" data-landing-hero>
            <Link href={signedIn ? "/map" : "/auth?mode=signup"} className="button-primary">
              Start planning
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className="button-secondary">
              See how it works
            </a>
          </div>
        </div>

        <div className="landing-hero-art" data-landing-art aria-label="Wrap route preview">
          <div className="landing-map-art">
            <svg
              className="landing-map-grid"
              viewBox="0 0 620 520"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M40 104H580M40 208H580M40 312H580M144 40V480M270 40V480M396 40V480M522 40V480" />
            </svg>
            <svg
              className="landing-route-line"
              viewBox="0 0 620 520"
              aria-hidden="true"
              focusable="false"
            >
              <path
                className="landing-route-blocked-casing"
                d="M92 384C167 365 226 320 306 296S430 212 522 130"
              />
              <path
                className="landing-route-blocked"
                d="M92 384C167 365 226 320 306 296S430 212 522 130"
              />
              <path
                className="landing-route-casing"
                d="M92 384C166 370 220 340 270 304C292 284 281 160 365 134C417 118 474 130 522 130"
              />
              <path
                className="landing-route-selected"
                d="M92 384C166 370 220 340 270 304C292 284 281 160 365 134C417 118 474 130 522 130"
              />
              <path className="landing-route-closure" d="M292 275L322 318" />
              <path className="landing-route-closure" d="M322 275L292 318" />
              <circle className="landing-route-endpoint" cx="92" cy="384" r="9" />
              <circle className="landing-route-endpoint" cx="522" cy="130" r="9" />
            </svg>
            <span className="landing-map-label landing-map-label-origin">You</span>
            <span className="landing-map-label landing-map-label-destination">Destination</span>
            <span className="landing-map-closure" aria-label="Reported disruption at the direct route">
              <span aria-hidden="true" />
              Street closed
            </span>
            <div className="landing-map-legend" aria-label="Route legend">
              <span><i className="landing-legend-selected" /> Example route</span>
            </div>
          </div>
        </div>
      </section>

      <section id="why-wrap" className="landing-statement" data-landing-reveal>
        <div>
          <h2>The route has to survive the city.</h2>
        </div>
      </section>

      <section id="how-it-works" className="landing-story" aria-labelledby="landing-story-title">
        <header className="landing-story-heading">
          <h2 id="landing-story-title">One trip.<br /><em>Three plot twists.</em></h2>
        </header>
        <div className="landing-story-layout">
          <div className="landing-story-chapters" aria-label="A trip that adapts">
            <article className="landing-story-chapter" data-active data-story-chapter="0">
              <div className="landing-story-chapter-copy">
                <p className="landing-story-step"><span>01</span></p>
                <h3>Broadway is closed.</h3>
              </div>
            </article>
            <article className="landing-story-chapter" data-story-chapter="1">
              <div className="landing-story-chapter-copy">
                <p className="landing-story-step"><span>02</span></p>
                <h3>Then the 1 train slows down.</h3>
              </div>
            </article>
            <article className="landing-story-chapter" data-story-chapter="2">
              <div className="landing-story-chapter-copy">
                <p className="landing-story-step"><span>03</span></p>
                <h3>Your next move is ready.</h3>
              </div>
            </article>
          </div>

          <div className="landing-story-stage" data-step="1" aria-label="Illustrative trip from Columbia University to Union Square">
            <div className="landing-story-stage-top">
              <span>SAMPLE · COLUMBIA → UNION SQUARE</span>
              <span className="landing-story-stage-count">01 / 03</span>
            </div>
            <div className="landing-story-canvas">
              <svg className="landing-story-map" viewBox="0 0 720 500" aria-hidden="true" focusable="false">
                <g className="landing-story-blocks">
                  <path d="M40 72h106v62H40zM168 72h92v62h-92zM282 72h104v62H282zM408 72h122v62H408zM552 72h128v62H552z" />
                  <path d="M40 160h72v74H40zM134 160h126v74H134zM282 160h104v74H282zM408 160h68v74h-68zM498 160h116v74H498zM630 160h50v74h-50z" />
                  <path d="M40 260h108v68H40zM170 260h90v68h-90zM282 260h104v68H282zM408 260h120v68H408zM550 260h130v68H550z" />
                  <path d="M40 354h72v80H40zM134 354h126v80H134zM282 354h104v80H282zM408 354h68v80h-68zM498 354h116v80H498zM630 354h50v80h-50z" />
                </g>
                <path className="landing-story-route landing-story-route-direct" id="story-route-direct" d="M78 402C188 386 213 313 316 296S489 201 644 114" />
                <path className="landing-story-route landing-story-route-walk" id="story-route-walk" d="M78 402C156 374 225 362 292 321C314 302 296 190 394 170C483 150 559 125 644 114" />
                <path className="landing-story-route landing-story-route-bus" id="story-route-bus" d="M78 402C148 382 172 332 223 303L313 303L313 214L472 214L472 144C525 126 579 112 644 114" />
                <path className="landing-story-closure" d="m302 279 29 34m0-34-29 34" />
                <circle className="landing-story-pin" cx="78" cy="402" r="11" />
                <circle className="landing-story-pin landing-story-pin-end" cx="644" cy="114" r="11" />
                <circle className="landing-story-traveler" cx="78" cy="402" r="7" />
                <circle className="landing-story-halo" cx="78" cy="402" r="18" />
              </svg>
              <span className="landing-story-place landing-story-origin">COLUMBIA</span>
              <span className="landing-story-place landing-story-destination">UNION SQUARE</span>
              <span className="landing-story-warning">CLOSED</span>
            </div>
            <div className="landing-story-readout">
              <div className="landing-story-progress-track"><span className="landing-story-progress-fill" /></div>
              <div className="landing-story-scenes" aria-live="polite">
                <div className="landing-story-scene" data-scene="0" aria-hidden="false">
                  <div><small>STREET CLOSURE</small><strong>Broadway</strong></div>
                  <strong className="landing-story-time"><span className="landing-story-duration">34</span><i> min</i></strong>
                </div>
                <div className="landing-story-scene" data-scene="1" aria-hidden="true">
                  <div><small>SERVICE DELAY</small><strong>1 train · +11 min</strong></div>
                  <strong className="landing-story-time"><span>34</span><i> min</i></strong>
                </div>
                <div className="landing-story-scene" data-scene="2" aria-hidden="true">
                  <div><small>NEW ROUTE</small><strong>M7 bus · +5 min</strong></div>
                  <strong className="landing-story-time"><span>29</span><i> min</i></strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta" data-landing-reveal>
        <h2>Leave room for the city to change.</h2>
        <Link href={signedIn ? "/map" : "/auth?mode=signup"} className="button-primary">
          {signedIn ? "Open the map" : "Get started with Wrap"}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="landing-footer-brand">
          <span className="landing-footer-dot" aria-hidden="true" />
          Wrap
        </Link>
        <div>
          {signedIn ? (
            <SignOutButton className="landing-sign-in" />
          ) : (
            <>
              <Link href="/auth?mode=signin">Sign in</Link>
              <Link href="/auth?mode=signup">Create account</Link>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
