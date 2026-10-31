/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        swiss: {
          bg: '#F4F4F0',
          paper: '#FFFFFF',
          card: '#FBFBFA',
          subtle: '#EFEFEA',
          border: '#E2E2DC',
          darkBorder: '#C8C8BF',
          ink: '#121212',
          muted: '#666660',
          faint: '#999990',
          orange: '#EA580C',
          orangeHover: '#C2410C',
          orangeDim: '#FFF4ED',
          warning: '#D97706',
          critical: '#DC2626',
        },
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
