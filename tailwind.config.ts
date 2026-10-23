import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clear: "#34b37e",
        watch: "#e3a524",
        warn: "#ec7a3c",
        flag: "#e5484d",
      },
    },
  },
  plugins: [],
} satisfies Config;
