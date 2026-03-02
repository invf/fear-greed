import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations("home");

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section
        className="card glow p-6 md:p-8"
        style={{
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Cinematic background gradients */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(900px 260px at 18% 0%, rgba(240,185,11,0.18), transparent 60%), radial-gradient(800px 260px at 85% 10%, rgba(14,203,129,0.12), transparent 60%), radial-gradient(700px 240px at 50% 120%, rgba(124,58,237,0.10), transparent 60%)",
          }}
        />

        {/* subtle grain */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: 0.08,
            mixBlendMode: "overlay",
            backgroundImage:
              "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22><filter id=%22n%22 x=%220%22 y=%220%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%222%22 stitchTiles=%22stitch%22/></filter><rect width=%22300%22 height=%22300%22 filter=%22url(%23n)%22 opacity=%220.45%22/></svg>')",
          }}
        />

        <div className="grid md:grid-cols-2 gap-6 items-center relative">
          {/* Left: text */}
          <div>
            {/* Premium crypto badge */}
            <div className="pcBadgeWrap">
              <div className="pcBadge">
                <span className="pcBadgeShine" aria-hidden="true" />
                <span className="pcBadgeDot" aria-hidden="true" />
                <span className="pcBadgeLeft">Chrome Extension</span>
                <span className="pcBadgeSep">•</span>
                <span className="pcBadgeRight">Trading Overlay</span>
              </div>
            </div>
            <div className="kicker">{t("kicker")}</div>

            <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
              {t("title")} <span className="gradText">{t("titleAccent")}</span>
            </h1>

            <p className="mt-4 muted text-base leading-relaxed max-w-xl">
              {t("subtitle")}
            </p>

            <div className="mt-6 flex gap-3 flex-wrap">
              <a className="btn btnPrimary" href="/pricing">
                {t("ctaPricing")}
              </a>
              <a className="btn" href="/docs">
                {t("ctaDocs")}
              </a>
            </div>

            {/* mini trust line */}
            <div className="mt-5 muted text-sm" style={{ opacity: 0.85 }}>
              <span style={{ fontWeight: 900 }}>
                {t("trustLineStrong")}
              </span>{" "}
              {t("trustLine")}
            </div>
          </div>

          {/* Right: cinematic video */}
          <div
            style={{
              position: "relative",
            }}
          >
            {/* glow behind */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: -18,
                borderRadius: 28,
                background:
                  "radial-gradient(400px 240px at 30% 20%, rgba(240,185,11,0.22), transparent 60%), radial-gradient(420px 260px at 70% 30%, rgba(14,203,129,0.16), transparent 60%), radial-gradient(420px 280px at 50% 80%, rgba(124,58,237,0.14), transparent 60%)",
                filter: "blur(18px)",
                opacity: 0.9,
                pointerEvents: "none",
              }}
            />

            {/* frame */}
            <div
              className="overflow-hidden rounded-2xl border"
              style={{
                position: "relative",
                borderColor: "rgba(43,49,57,0.85)",
                background: "rgba(11,14,17,0.55)",
                boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
                transform: "translateZ(0)",
              }}
            >
              {/* top glass highlight */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: 90,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.10), transparent)",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />

              {/* vignette */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(120% 90% at 50% 30%, transparent 40%, rgba(0,0,0,0.55) 100%)",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />

              <video
                className="w-full h-auto block"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                disablePictureInPicture
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  transform: "scale(1.02)",
                  filter: "saturate(1.08) contrast(1.05)",
                }}
              >
                <source src="/media/panel-preview.mp4" type="video/mp4" />
              </video>
            </div>

            {/* small caption */}
            <div
              className="muted text-sm"
              style={{
                marginTop: 10,
                textAlign: "center",
                opacity: 0.85,
              }}
            >
              {t("videoCaption")}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="card p-6">
        <div className="kicker">{t("howItWorksKicker")}</div>
        <div className="mt-2 text-3xl font-black">{t("howItWorksTitle")}</div>
        <div className="mt-2 muted text-sm">{t("howItWorksSub")}</div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="kicker">{t("step1Kicker")}</div>
            <div className="mt-2 text-lg font-black">{t("step1Title")}</div>
            <div className="mt-2 muted text-sm leading-relaxed">{t("step1Text")}</div>
          </div>

          <div className="card p-5">
            <div className="kicker">{t("step2Kicker")}</div>
            <div className="mt-2 text-lg font-black">{t("step2Title")}</div>
            <div className="mt-2 muted text-sm leading-relaxed">{t("step2Text")}</div>
          </div>

          <div className="card p-5">
            <div className="kicker">{t("step3Kicker")}</div>
            <div className="mt-2 text-lg font-black">{t("step3Title")}</div>
            <div className="mt-2 muted text-sm leading-relaxed">{t("step3Text")}</div>
          </div>
        </div>
      </section>
    </div>
  );
}