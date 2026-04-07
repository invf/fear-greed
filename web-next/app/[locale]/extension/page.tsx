import ExtensionHero from "@/components/landing/ExtensionHero";
import ExtensionPain from "@/components/landing/ExtensionPain";
import ExtensionFeatures from "@/components/landing/ExtensionFeatures";
import ExtensionHowItWorks from "@/components/landing/ExtensionHowItWorks";
import ExtensionComparison from "@/components/landing/ExtensionComparison";
import ExtensionFAQ from "@/components/landing/ExtensionFAQ";
import ExtensionCTA from "@/components/landing/ExtensionCTA";

export default function ExtensionPage() {
  return (
    <>
      <ExtensionHero />
      <ExtensionPain />
      <ExtensionFeatures />
      <ExtensionHowItWorks />
      <ExtensionComparison />
      <ExtensionFAQ />
      <ExtensionCTA />
    </>
  );
}