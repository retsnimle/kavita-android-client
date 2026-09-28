/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        kavita: {
          dark: '#121214',
          card: '#1a1a1e',
          border: '#2e2e36',
          primary: '#22c55e',
          accent: '#3b82f6',
        }
      }
    },
  },
  plugins: [],
}
