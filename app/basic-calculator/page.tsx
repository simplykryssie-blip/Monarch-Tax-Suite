import type { Metadata } from "next";
import { BasicCalculator } from "@/components/calculator/basic-calculator";

export const metadata: Metadata = { title: "Tax Calculator", description: "Estimate your federal income tax.", robots: { index: false, follow: false } };

export default function BasicCalculatorPage() {
  return <BasicCalculator />;
}
