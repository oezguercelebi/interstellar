import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1280px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Signal — International Orange. The one accent; flat, never gradient.
        stellar: {
          DEFAULT: "#FF4D00",
          hot: "#E64500",
          soft: "rgba(255,77,0,0.12)",
          ink: "#0A0B0D",
        },
        // Instrument-light status accents (status + variant tagging only).
        ios: {
          blue: "#58A6FF",
          purple: "#A371F7",
          green: "#2EA043",
          orange: "#FF9500",
          red: "#E5484D",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        glass: "0 1px 0 rgba(255,255,255,0.04) inset",
        "glass-lg": "0 24px 80px rgba(0,0,0,0.5)",
        stellar: "0 8px 24px -12px rgba(0,0,0,0.4)",
        "stellar-sm": "0 1px 2px rgba(0,0,0,0.25)",
        device: "0 40px 120px -24px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "fade-in-blur": { from: { opacity: "0", filter: "blur(6px)" }, to: { opacity: "1", filter: "blur(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        "live-pulse": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(46,160,67,0.5)" },
          "50%": { opacity: "0.7", boxShadow: "0 0 0 6px rgba(46,160,67,0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "orbit-spin": { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out both",
        "fade-in-blur": "fade-in-blur 0.6s ease-out both",
        "scale-in": "scale-in 0.3s ease-out both",
        "live-pulse": "live-pulse 2s ease-in-out infinite",
        shimmer: "shimmer 1.8s infinite",
        "orbit-spin": "orbit-spin 14s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
