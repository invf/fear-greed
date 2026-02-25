import Link from "next/link";

export const metadata = {
  title: "Docs • Fear & Greed",
  description: "How to install the extension, get an API key, and troubleshoot common issues.",
};

const CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_STORE_URL || "https://chromewebstore.google.com/";
const PRICING_URL = "/pricing";
const DASHBOARD_URL = "/dashboard";

function Card({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      {kicker ? <div className="kicker">{kicker}</div> : null}
      <div className="mt-2 text-xl font-black">{title}</div>
      <div className="mt-3 muted text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="kicker">Step {n}</div>
      <div className="mt-2 text-lg font-black">{title}</div>
      <div className="mt-3 muted text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function CodeBox({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="card p-4"
      style={{
        background: "rgba(11,14,17,0.45)",
        borderColor: "rgba(43,49,57,0.85)",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.4,
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="space-y-6">
      {/* HERO */}
      <section className="card glow p-6 md:p-8">
        <div className="kicker">Docs</div>
        <h1 className="mt-2 text-4xl md:text-5xl font-black leading-tight">
          How to use <span className="gradText">Fear &amp; Greed</span> Extension
        </h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-2xl">
          Тут усе, що потрібно: як встановити розширення, як отримати API key та що робити, якщо
          щось не працює (невірний ключ, ліміт, “—” замість даних).
        </p>

        <div className="mt-6 flex gap-3 flex-wrap">
          <a className="btn btnPrimary" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
            Install Extension
          </a>
          <Link className="btn" href={PRICING_URL}>
            Pricing
          </Link>
          <Link className="btn btnGhost" href={DASHBOARD_URL}>
            Dashboard
          </Link>
        </div>
      </section>

      {/* QUICK START */}
      <section className="card p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">Quick start</div>
            <div className="mt-2 text-3xl font-black">Start in 2–3 minutes</div>
            <div className="mt-2 muted text-sm">
              Рекомендовано: спочатку встановити розширення → потім отримати ключ → вставити в Settings.
            </div>
          </div>
          <span className="badge">
            <span className="kicker" style={{ margin: 0 }}>
              TIP
            </span>
            <span className="muted text-sm font-extrabold">Use Binance / TradingView</span>
          </span>
        </div>

        <div className="mt-5 grid md:grid-cols-3 gap-4">
          <Step n={1} title="Install extension">
            Встанови розширення з Chrome Web Store. Після встановлення відкрий Binance або TradingView
            і увімкни sidepanel.
          </Step>

          <Step n={2} title="Get API key">
            Вибери тариф на сторінці <Link href="/pricing">Pricing</Link>. Після оплати (або для Free)
            ключ буде доступний у <Link href="/dashboard">Dashboard</Link>.
          </Step>

          <Step n={3} title="Paste key in Settings">
            В розширенні відкрий <b>Settings</b> → встав ключ → натисни <b>Check key</b>.
            Після цього план і ліміти підтягнуться автоматично.
          </Step>
        </div>
      </section>

      {/* WHERE IS SETTINGS */}
      <section className="grid md:grid-cols-2 gap-4">
        <Card kicker="Extension" title="Where do I enter the key?">
          Відкрий sidepanel → вкладка <b>Settings</b> → поле <b>API key</b> → кнопка <b>Check key</b>.
          <br />
          Якщо ключ правильний — побачиш статус плану та квоту (наприклад: <b>PRO • 3/50</b>).
        </Card>

        <Card kicker="Website" title="Where do I get the key?">
          На сайті ключ з’явиться в <Link href="/dashboard">Dashboard</Link> після підключення плану.
          Для Free — ключ може бути не потрібен (або буде “basic key” — залежить від твоєї логіки).
          <br />
          Сторінка тарифів: <Link href="/pricing">Pricing</Link>.
        </Card>
      </section>

      {/* TROUBLESHOOTING */}
      <section className="card p-6">
        <div className="kicker">Troubleshooting</div>
        <div className="mt-2 text-3xl font-black">If something doesn’t work</div>

        <div className="mt-5 grid md:grid-cols-2 gap-4">
          <Card kicker="Problem" title="I see “—” instead of data">
            1) Переконайся, що ти на підтримуваній сторінці (Binance/Bybit/OKX/TradingView).<br />
            2) Переключи пару (symbol) і натисни <b>Refresh</b> в розширенні.<br />
            3) Перевір інтернет / VPN / блокування запитів.
          </Card>

          <Card kicker="Problem" title="Check key says invalid / unauthorized">
            1) Перевір, що вставив ключ без пробілів на початку/в кінці.<br />
            2) Натисни <b>Clear</b> → встав ще раз → <b>Check key</b>.<br />
            3) Якщо ключ був відкликаний — отримай новий у Dashboard.
          </Card>

          <Card kicker="Problem" title="Limit reached / quota exceeded">
            Це означає, що денний ліміт по плану вичерпаний. Рішення:<br />
            • зачекати до наступного дня (reset)<br />
            • або перейти на вищий план на сторінці <Link href="/pricing">Pricing</Link>.
          </Card>

          <Card kicker="Problem" title="Plan badge shows wrong plan">
            Натисни <b>Check key</b> у Settings (примусова валідація). Якщо не допомогло — зроби
            <b> Refresh</b> і зміни пару (symbol), щоб квота оновилась.
          </Card>
        </div>

        <div className="mt-5">
          <div className="kicker">Example</div>
          <div className="mt-2 text-xl font-black">What “valid response” looks like</div>
          <div className="mt-3 muted text-sm">
            (Це приклад. Реальний формат залежить від бекенду, але сенс той самий.)
          </div>

          <div className="mt-3">
            <CodeBox>
              {`{
  "valid": true,
  "plan": "PRO",
  "used": 3,
  "limit": 50,
  "remaining": 47,
  "day": "2026-02-23"
}`}
            </CodeBox>
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section className="grid md:grid-cols-2 gap-4">
        <Card kicker="Security" title="Is it safe to paste the key?">
          Так. Ключ використовується лише для доступу до API та лімітів. Не вставляй ключ у сторонні сайти
          або “боти”. Якщо підозрюєш витік — відкликай ключ у Dashboard і створи новий.
        </Card>

        <Card kicker="Privacy" title="What data do we store?">
          Мінімум: Install ID (для анти-фроду і стабільності лімітів) + твій API key у браузері (sync storage).
          Дані з біржі не зберігаємо — лише запитуємо symbol з URL та повертаємо індекс.
        </Card>
      </section>

      {/* CTA */}
      <section className="card p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker">Next</div>
            <div className="mt-2 text-3xl font-black">Ready to upgrade?</div>
            <div className="mt-2 muted text-sm">
              Перейди на PRO/VIP, оплати через MetaMask і отримай ключ для розширення.
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Link className="btn btnPrimary" href="/pricing#checkout">
              Go to Checkout
            </Link>
            <a className="btn" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
              Install Extension
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}