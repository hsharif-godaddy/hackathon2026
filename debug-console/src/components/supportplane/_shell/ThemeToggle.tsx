'use client';

import { Moon, Sun } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';

export default function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
    return (
        <button onClick={onToggle} aria-label="Toggle theme"
            className={`${sp.themeToggle} ${isDark ? sp.themeDark : sp.themeLight}`}>
            <span className={`${sp.themeKnob} ${isDark ? sp.themeKnobDark : sp.themeKnobLight}`}>
                {isDark ? <Moon size={11} color="#fff" strokeWidth={2.5} /> : <Sun size={11} color="#fff" strokeWidth={2.5} />}
            </span>
        </button>
    );
}
