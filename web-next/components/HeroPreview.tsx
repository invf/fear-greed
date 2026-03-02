"use client";

import { useMemo, useRef, useState } from "react";

export default function HeroPreview() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  function onMove(e: React.MouseEvent) {
    if (prefersReducedMotion) return;
    const el = ref.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height; // 0..1

    const max = 9; // degrees
    const rotY = (px - 0.5) * (max * 2);
    const rotX = (0.5 - py) * (max * 2);

    const sheenX = (px - 0.5) * 60;
    const sheenY = (py - 0.5) * 40;

    el.style.setProperty("--sheenX", `${sheenX}px`);
    el.style.setProperty("--sheenY", `${sheenY}px`);
    el.style.setProperty("--sheenA", "1");

    el.style.transform = `perspective(900px) rotateX(${rotX.toFixed(
      2
    )}deg) rotateY(${rotY.toFixed(2)}deg) translateY(-2px)`;
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--sheenA", "0");
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px)";
    setActive(false);
  }

  function onEnter() {
    setActive(true);
  }

  return (
    <div className="floatAnim">
      <div
        ref={ref}
        className="previewFrame"
        onMouseMove={onMove}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          transition: prefersReducedMotion
            ? "none"
            : active
            ? "transform 60ms linear"
            : "transform 240ms ease",
        }}
      >
        <div className="previewBadge badge">
          <span className="kicker" style={{ margin: 0 }}>
            LIVE PREVIEW
          </span>
          <span className="muted text-sm font-extrabold">Extension UI</span>
        </div>

        <div
          className="previewBadgeRight badge"
          style={{ borderColor: "rgba(240,185,11,0.55)" }}
        >
          <span className="muted text-sm font-extrabold">RISK</span>
          <span className="font-black" style={{ color: "var(--yellow2)" }}>
            67/100
          </span>
        </div>

        <video
          className="previewImg"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          // Якщо немає постера — просто видали цей рядок:
          poster="/media/panel-preview-poster.jpg"
        >
          <source src="/media/panel-preview.webm" type="video/webm" />
          <source src="/media/panel-preview.mp4" type="video/mp4" />
        </video>

        <div className="previewGlass" />
        <div className="previewSheen" />
      </div>

      <div className="shotInner" style={{ marginTop: 10 }}>
        Відео: webm + mp4 fallback. Рекомендована ширина 900–1100px, без звуку, loop-friendly.
      </div>
    </div>
  );
}