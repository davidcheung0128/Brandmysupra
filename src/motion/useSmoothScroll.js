import { useEffect, useRef } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cinemaRefs, phaseFromProgress } from "./cinemaState.js";

gsap.registerPlugin(ScrollTrigger);

/**
 * Lenis + ScrollTrigger cinema driver.
 * Writes progress into cinemaRefs and notifies React via onPhase / onProgress.
 */
export function useSmoothScroll({ stageSelector = "#cinema-stage", enabled = true, onPhase, onProgress }) {
  const lenisRef = useRef(null);
  const onPhaseRef = useRef(onPhase);
  const onProgressRef = useRef(onProgress);
  onPhaseRef.current = onPhase;
  onProgressRef.current = onProgress;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cinemaRefs.reducedMotion.current = reduced;

    if (!enabled || reduced) {
      cinemaRefs.progress.current = 1;
      cinemaRefs.smoothed.current = 1;
      cinemaRefs.phase.current = "configurator";
      onPhaseRef.current?.("configurator");
      onProgressRef.current?.(1);
      document.documentElement.classList.add("cinema-reduced");
      return undefined;
    }

    document.documentElement.classList.add("lenis");
    const lenis = new Lenis({
      duration: 1.35,
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.05,
    });
    lenisRef.current = lenis;

    lenis.on("scroll", ScrollTrigger.update);
    const ticker = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(ticker);
    gsap.ticker.lagSmoothing(0);

    const stage = document.querySelector(stageSelector);
    if (!stage) return undefined;

    let lastPhase = "presentation";
    const trigger = ScrollTrigger.create({
      trigger: stage,
      start: "top top",
      end: "bottom bottom",
      scrub: 1.4,
      onUpdate: (self) => {
        const progress = self.progress;
        cinemaRefs.progress.current = progress;
        onProgressRef.current?.(progress);
        const phase = phaseFromProgress(progress);
        if (phase !== lastPhase) {
          lastPhase = phase;
          cinemaRefs.phase.current = phase;
          onPhaseRef.current?.(phase);
        }
      },
    });

    return () => {
      trigger.kill();
      gsap.ticker.remove(ticker);
      lenis.destroy();
      lenisRef.current = null;
      document.documentElement.classList.remove("lenis");
      ScrollTrigger.getAll().forEach((item) => item.kill());
    };
  }, [enabled, stageSelector]);

  return lenisRef;
}
