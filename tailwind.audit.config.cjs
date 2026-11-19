/**
 * Isolated Tailwind CSS audit build for VALERIAN V20.
 * This output is NOT linked into the app until visual/offline parity is verified.
 * Keep custom tokens aligned with the existing Tailwind v4 theme.
 */
const brand = (shade, fallback) =>
  `color-mix(in srgb, var(--brand-${shade}, ${fallback}) calc(<alpha-value> * 100%), transparent)`;

module.exports = {
  content: [
    './index.html',
    './engine-runtime.js'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: brand('50', '#f5f3ff'),
          100: brand('100', '#ede9fe'),
          200: brand('200', '#ddd6fe'),
          300: brand('300', '#c4b5fd'),
          500: brand('500', '#8b5cf6'),
          600: brand('600', '#7c3aed'),
          700: brand('700', '#6d28d9'),
          800: brand('800', '#5b21b6'),
          900: brand('900', '#4c1d95')
        }
      },
      boxShadow: {
        '2xs': '0 1px var(--tw-shadow-color, rgb(0 0 0 / 0.05))',
        'xs': '0 1px 2px 0 var(--tw-shadow-color, rgb(0 0 0 / 0.05))'
      },
      fontFamily: {
        sans: ['Cairo', 'Tahoma', 'Arial', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
};
