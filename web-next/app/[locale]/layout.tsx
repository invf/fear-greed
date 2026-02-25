import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Fear & Greed — Crypto Panel",
  description: "Fear & Greed panel for Binance/TradingView + Web3 subscription."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}