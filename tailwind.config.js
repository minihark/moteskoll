/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        iron: {
          950: '#0b0d11',
          900: '#12151c',
          850: '#171c26',
          800: '#1e2432',
          700: '#2b3447',
          600: '#3d4963',
          500: '#546383',
          400: '#8695b7',
          300: '#b2bed6',
          200: '#d7dfec',
          100: '#f0f3f9',
        },
        volt: {
          500: '#84cc16',
          400: '#a3e635',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
