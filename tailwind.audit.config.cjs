/**
 * Isolated Tailwind CSS audit build for VALERIAN V20.
 * This output is NOT linked into the app until visual/offline parity is verified.
 * Keep the custom theme tokens aligned with the existing Tailwind v4 theme.
 */
module.exports = {
  content: [
    './index.html',
    './engine-runtime.js'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50, #f5f3ff)',
          100: 'var(--brand-100, #ede9fe)',
          200: 'var(--brand-200, #ddd6fe)',
          300: 'var(--brand-300, #c4b5fd)',
          500: 'var(--brand-500, #8b5cf6)',
          600: 'var(--brand-600, #7c3aed)',
          700: 'var(--brand-700, #6d28d9)',
          800: 'var(--brand-800, #5b21b6)',
          900: 'var(--brand-900, #4c1db6)'
        }
      },
      fontFamily: {
        sans: ['Cairo', 'Tahoma', 'Arial', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
};
