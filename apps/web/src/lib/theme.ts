export type Theme = 'light' | 'dark';

export const readStoredTheme = (): Theme | null => {
	if (typeof window === 'undefined') return null;
	const v = window.localStorage.getItem('theme');
	if (v === 'light' || v === 'dark') return v;
	return null;
};

export const readPreferredTheme = (): Theme => {
	if (typeof window === 'undefined') return 'dark';
	const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
	return prefersDark ? 'dark' : 'light';
};

export const getInitialTheme = (): Theme => readStoredTheme() ?? readPreferredTheme();

export const setTheme = (theme: Theme): void => {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', theme === 'dark');
	if (typeof window === 'undefined') return;
	window.localStorage.setItem('theme', theme);
};
