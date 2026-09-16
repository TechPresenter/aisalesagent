import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { appBrand } from "@/config/app-brand";
import "./globals.css";

/** Brand Guidelines §4: Inter across dashboard, marketing site and generated reports. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: `AI Sales Agent · ${appBrand.name}`,
  description:
    "Find, call, qualify and convert leads with AI voice agents — with a human one click away.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
