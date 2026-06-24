'use client';

import { useCallback, useEffect, useState } from 'react';

import LogsPanelBase, { type LogSource, type LogsView } from '@/components/LogsPanel';

export default function LogsPanel() {
    const [sources, setSources] = useState<LogSource[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [view, setView] = useState<LogsView>('logs');

    useEffect(() => {
        fetch('/api/log-sources')
            .then((res) => (res.ok ? res.json() : { sources: [] }))
            .then((data: { sources?: LogSource[] }) => setSources(data.sources ?? []))
            .catch(() => setSources([]));
    }, []);

    const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

    return (
        <LogsPanelBase
            sources={sources}
            refreshKey={refreshKey}
            onRefresh={onRefresh}
            view={view}
            onViewChange={setView}
        />
    );
}