/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        pretendard: ["Pretendard", "ui-sans-serif", "system-ui"],
      },
      boxShadow: {
        soft: "0 12px 40px rgba(15, 23, 42, 0.15)",
        glow: "0 0 0 1px rgba(255, 255, 255, 0.2), 0 20px 60px rgba(15, 23, 42, 0.28)",
      },
      backgroundImage: {
        mesh: "radial-gradient(at 20% 10%, rgba(254, 243, 199, 0.4) 0px, transparent 40%), radial-gradient(at 80% 20%, rgba(165, 243, 252, 0.4) 0px, transparent 45%), radial-gradient(at 50% 80%, rgba(253, 186, 116, 0.25) 0px, transparent 50%)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(234, 88, 12, 0.35)" },
          "50%": { boxShadow: "0 0 0 12px rgba(234, 88, 12, 0)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        pulseGlow: "pulseGlow 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
