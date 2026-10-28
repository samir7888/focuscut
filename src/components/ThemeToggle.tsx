import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const stored = localStorage.getItem('focuscut-theme') as 'dark' | 'light' | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const t = stored || (prefersDark ? 'dark' : 'light');
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('focuscut-theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <button
      onClick={toggle}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-line"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
