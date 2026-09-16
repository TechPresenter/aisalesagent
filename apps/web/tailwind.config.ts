import type { Config } from "tailwindcss";

/**
 * Design tokens are taken verbatim from Brand Guidelines Part I §3 (Color Palette).
 * Semantic names are the contract: a colour means the same thing in a badge, a chart
 * series and a button, so never reach for a raw hex inside a component.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./config/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary palette
        "brand-navy": "#0F2337",
        "brand-green": "#19B969",
        "deep-green": "#0F6941",
        "accent-blue": "#237DF5",
        "accent-purple": "#7D55CD",
        // Semantic / status palette
        "alert-red": "#F55F5F",
        "warning-amber": "#F5A623",
        "neutral-gray": "#919BA5",
        "bg-gray": "#F5F5F5",
        surface: "#FFFFFF",
        // Vendor identity (config/app-brand.ts). Kept apart from the semantic palette
        // above: these three are the Appsgain logo and its CTA gradient, never a status.
        "brand-orange": "#F7671E",
        "brand-magenta": "#E5199B",
        "brand-violet": "#9333EA",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      fontSize: {
        // Brand Guidelines §4 Typography scale
        display: ["32px", { lineHeight: "1.15", fontWeight: "700" }],
        h2: ["24px", { lineHeight: "1.25", fontWeight: "700" }],
        h3: ["18px", { lineHeight: "1.35", fontWeight: "600" }],
        stat: ["32px", { lineHeight: "1.1", fontWeight: "700" }],
        body: ["14px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.45" }],
      },
      borderRadius: {
        card: "14px",
        btn: "9px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 14px rgba(15,35,55,0.10)",
        panel: "0 2px 10px rgba(15,35,55,0.06)",
      },
      spacing: {
        sidebar: "240px",
        header: "72px",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "1" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        wave: "wave 1s ease-in-out infinite",
        "fade-up": "fade-up 0.35s ease-out both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
