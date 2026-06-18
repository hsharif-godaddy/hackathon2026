'use client';

export default function SPIcon({ size = 24 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
            <circle cx="13" cy="13" r="11" stroke="#0891b2" strokeWidth="2" />
            <path d="M9 13c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" />
            <circle cx="13" cy="18" r="1.5" fill="#0891b2" />
        </svg>
    );
}
