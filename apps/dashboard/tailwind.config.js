/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#060a10",
        panel: "#0b121c",
        signal: "#59f6d2",
        electric: "#54a7ff",
      },
      boxShadow: {
        signal: "0 0 32px rgba(89, 246, 210, 0.12)",
      },
    },
  },
  plugins: [],
};

