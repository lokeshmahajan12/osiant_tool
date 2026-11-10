/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070b12",
          900: "#0a0f1a",
          850: "#0d1422",
          800: "#111a2c",
          700: "#182338",
        },
        accent: {
          DEFAULT: "#22d3ee",
          soft: "#67e8f9",
          dim: "#155e75",
        },
        signal: {
          DEFAULT: "#34d399",
          warn: "#fbbf24",
          danger: "#f87171",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "ui-monospace", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.25), 0 8px 24px -8px rgba(0,0,0,0.6)",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        pulseSoft: "pulseSoft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
