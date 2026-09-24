import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/** Line-mask reveal on scroll enter. */
export default function RevealText({ as: Tag = "p", className = "", children }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.style.opacity = "1";
      node.style.transform = "none";
      return undefined;
    }

    const tween = gsap.fromTo(
      node,
      { yPercent: 28, opacity: 0, clipPath: "inset(0 0 100% 0)" },
      {
        yPercent: 0,
        opacity: 1,
        clipPath: "inset(0 0 0% 0)",
        duration: 1.05,
        ease: "power3.out",
        scrollTrigger: {
          trigger: node,
          start: "top 88%",
          toggleActions: "play none none none",
        },
      },
    );

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <Tag ref={ref} className={`reveal-text ${className}`.trim()}>
      {children}
    </Tag>
  );
}
