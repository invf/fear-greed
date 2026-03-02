import Link from "next/link";

type Props = {
  name: string;
  price: string;
  perks: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
};

export default function PlanCard({ name, price, perks, cta, highlight }: Props) {
  return (
    <div className={`card p-5 ${highlight ? "glow" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="kicker">{name}</div>
          <div className="mt-2 text-3xl font-black">{price}</div>
        </div>

        {highlight ? (
          <span className="badge" style={{ borderColor: "rgba(240,185,11,0.70)", background: "rgba(240,185,11,0.12)" }}>
            <span className="kicker" style={{ margin: 0, color: "rgba(252,213,53,1)" }}>Popular</span>
          </span>
        ) : (
          <span className="badge" style={{ borderColor: "rgba(43,49,57,0.75)" }}>
            <span className="muted text-sm font-extrabold">Plan</span>
          </span>
        )}
      </div>

      <div className="hr" />

      <ul className="space-y-2 text-sm">
        {perks.map((p) => (
          <li key={p} className="muted font-semibold">• {p}</li>
        ))}
      </ul>

      <div className="mt-5">
        <Link href={cta.href} className={`btn ${highlight ? "btnPrimary" : ""} w-full`}>
          {cta.label}
        </Link>
      </div>
    </div>
  );
}