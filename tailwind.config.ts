import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Flat, minimal palette matching dallastek.no.
        bg: "#282c2f", // --color-main
        surface: "#2d3134",
        elevated: "#363b3f",
        border: "#3c4247",
        muted: "#9aa0a6",
        fg: "#ededed", // --foreground
        accent: "#f4b860", // --color-accent (warm gold)
        "accent-fg": "#282c2f",
        danger: "#ef6a6a",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Playfair Display", "Georgia", "serif"],
      },
      borderRadius: {
        none: "0",
        sm: "0",
        DEFAULT: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        // Kept for profile avatars only.
        full: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
