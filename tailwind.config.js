/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./sidepanel.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        arc: {
          bg: '#121214',
          surface: '#1c1c1f',
          hover: '#26262b',
          active: '#2f2f36',
          border: 'rgba(255, 255, 255, 0.08)',
          text: '#f4f4f5',
          muted: '#a1a1aa',
          subtle: '#71717a'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif'
        ]
      }
    },
  },
  plugins: [],
}
