import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clear: "#22c55e",
        watch: "#eab308",
        warn: "#f97316",
        flag: "#ef4444",
      },
    },
  },
  plugins: [],
} satisfies Config;
