import React, { useEffect, useRef, useState } from "react";

/** Desktop-only cinematic cursor: aluminum dot + delayed ring. */
export default function CustomCursor({ label = "", visible = true }) {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const labelRef = useRef(null);
  const pos = useRef({ x: 0, y: 0, rx: 0, ry: 0 });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(fine && !reduced);
    if (fine && !reduced) document.documentElement.classList.add("has-custom-cursor");
    return () => document.documentElement.classList.remove("has-custom-cursor");
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onMove = (event) => {
      pos.current.x = event.clientX;
      pos.current.y = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let frame = 0;
    const tick = () => {
      const { x, y } = pos.current;
      pos.current.rx += (x - pos.current.rx) * 0.18;
      pos.current.ry += (y - pos.current.ry) * 0.18;
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${pos.current.rx}px, ${pos.current.ry}px, 0)`;
      if (labelRef.current) labelRef.current.style.transform = `translate3d(${pos.current.rx}px, ${pos.current.ry}px, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [enabled]);

  if (!enabled || !visible) return null;

  return (
    <div className={`custom-cursor ${label ? "is-labeled" : ""}`} aria-hidden="true">
      <i ref={dotRef} className="cursor-dot" />
      <i ref={ringRef} className="cursor-ring" />
      <span ref={labelRef} className="cursor-label">{label}</span>
    </div>
  );
}
