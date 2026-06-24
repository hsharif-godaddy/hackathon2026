'use client';

import { useEffect, useRef, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import { SERVICE_HEALTH_SKELETON } from '@/components/supportplane/types';

interface ServiceHealth {
    name: string;
    ok: boolean | null;
    detail: string;
}

// Simple module-level cache so the bar doesn't re-fetch on every panel navigation.
let _cache: ServiceHealth[] | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 120_000;   // live checks hit real APIs — cache 2 min

export default function ServiceHealthBar() {
    const [services, setServices] = useState<ServiceHealth[]>(
        _cache ?? SERVICE_HEALTH_SKELETON.map(s => ({ ...s, detail: 'Checking…' })),
    );
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (fetchedRef.current) return;
        fetchedRef.current = true;

        // Serve from cache if fresh
        if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
            setServices(_cache);
            return;
        }

        fetch('/api/supportplane/services/health', { signal: AbortSignal.timeout(15_000) })
            .then(r => r.ok ? r.json() as Promise<ServiceHealth[]> : null)
            .then(data => {
                if (data) {
                    _cache = data;
                    _cacheAt = Date.now();
                    setServices(data);
                }
            })
            .catch(() => { /* leave skeleton showing */ });
    }, []);

    return (
        <div className={sp.healthBar}>
            <span className={sp.healthBarLabel}>Services</span>
            {services.map((s) => {
                const color = s.ok === null ? '#f59e0b' : s.ok ? '#10b981' : '#ef4444';
                return (
                    <span
                        key={s.name}
                        className={sp.healthPillMini}
                        style={{ borderColor: `${color}35`, color }}
                        title={`${s.name} — ${s.detail}`}
                    >
                        <span className={sp.healthDotDot} style={{ background: color }} />
                        {s.name}
                    </span>
                );
            })}
        </div>
    );
}
