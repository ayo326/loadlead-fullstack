import type { Config } from "tailwindcss";

// Theme tokens are sourced from src/index.css (CSS variables).
// design-system/MASTER.md is the source of truth for design decisions.
// Direction: Dispatch (Inter + JetBrains Mono) on operator surfaces;
// Hangar (Manrope headings) is scoped to the 6 pre-app pages.
export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: {
        "2xl": "1400px",
      },
    },
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
          // Subtle accent only — never a gradient. See MASTER §7.
          glow: "hsl(var(--primary-glow))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      // Dispatch by default. Hangar pages override their heading family via
      // the `.font-display-hangar` utility on the page root (see index.css).
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // 1.125 (major second) ramp. See MASTER §2.
      fontSize: {
        overline: ["0.6875rem", { lineHeight: "0.875rem", letterSpacing: "0.06em", fontWeight: "600" }], // 11/14
        label:    ["0.75rem",   { lineHeight: "1rem",      fontWeight: "500" }],                          // 12/16
        body:     ["0.875rem",  { lineHeight: "1.375rem" }],                                              // 14/22
        "body-md":["0.9375rem", { lineHeight: "1.5rem" }],                                                // 15/24
        mono:     ["0.8125rem", { lineHeight: "1.25rem",   fontWeight: "500" }],                          // 13/20
        h3:       ["1rem",      { lineHeight: "1.5rem",    fontWeight: "600" }],                          // 16/24
        h2:       ["1.25rem",   { lineHeight: "1.75rem",   fontWeight: "600" }],                          // 20/28
        h1:       ["1.5rem",    { lineHeight: "2rem",      fontWeight: "600", letterSpacing: "-0.01em" }],// 24/32
        display:  ["2rem",      { lineHeight: "2.5rem",    fontWeight: "600", letterSpacing: "-0.015em" }],// 32/40
      },
      // 4px base; rows + fields at 36px. See MASTER §3.
      spacing: {
        row: "2.25rem",          // 36px — table row + form field default
        "row-compact": "2rem",   // 32px — compact table row
        rail: "15rem",           // 240px — sidebar full width
        "rail-collapsed": "4rem",// 64px — rail-only
        "page-header": "3.5rem", // 56px
      },
      borderRadius: {
        none: "0",
        sm:   "0.25rem",  // 4px — inputs, buttons, chips, badges
        DEFAULT: "0.5rem",// 8px — cards (default), dropdown panels
        md:   "0.5rem",
        lg:   "0.75rem",  // 12px — modals, sheets, drawers
        xl:   "1rem",     // 16px — reserved (hero blocks only)
        full: "9999px",   // avatars, dot status indicators
      },
      // Neutral, flat-leaning. No primary-tint shadows. See MASTER §5.
      boxShadow: {
        "elev-0": "none",
        "elev-1": "0 1px 2px rgba(15, 23, 42, 0.04)",
        "elev-2": "0 4px 8px -2px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)",
        "elev-3": "0 12px 24px -8px rgba(15, 23, 42, 0.10), 0 4px 8px -4px rgba(15, 23, 42, 0.06)",
        "focus-ring": "0 0 0 3px hsl(var(--ring) / 0.18)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "240ms",
      },
      transitionTimingFunction: {
        out:  "cubic-bezier(0.2, 0.8, 0.2, 1)",
        in:   "cubic-bezier(0.4, 0, 1, 1)",
        soft: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "status-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.18s ease-out",
        "accordion-up": "accordion-up 0.18s ease-out",
        "status-pulse": "status-pulse 2s ease-in-out infinite",
        "fade-up": "fade-up 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
