/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
        },
        line: 'var(--line)',
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
        },
        focus: {
          DEFAULT: 'var(--focus)',
          ink: 'var(--focus-ink)',
        },
        rec: 'var(--rec)',
        ok: 'var(--ok)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        sans: ['Geist Sans', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        display: ['Bricolage Grotesque', 'Geist Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
