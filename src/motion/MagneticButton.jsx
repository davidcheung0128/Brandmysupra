import React, { useRef } from "react";

/** Primary CTA with magnetic label pull toward the pointer. */
export default function MagneticButton({ href, onClick, className = "", children, as = "a" }) {
  const rootRef = useRef(null);
  const innerRef = useRef(null);

  function onMove(event) {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = root.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    inner.style.transform = `translate3d(${x * 0.22}px, ${y * 0.28}px, 0)`;
  }

  function onLeave() {
    if (innerRef.current) innerRef.current.style.transform = "translate3d(0, 0, 0)";
  }

  const Tag = as;
  const shared = {
    ref: rootRef,
    className: `magnetic-button ${className}`.trim(),
    onPointerMove: onMove,
    onPointerLeave: onLeave,
    onClick,
  };

  if (Tag === "a") {
    return (
      <a {...shared} href={href}>
        <span ref={innerRef} className="magnetic-button-inner">{children}</span>
      </a>
    );
  }

  return (
    <button type="button" {...shared}>
      <span ref={innerRef} className="magnetic-button-inner">{children}</span>
    </button>
  );
}
