import v8 from 'node:v8';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MB = 1024 * 1024;
const fmtMB = (bytes: number): string => `${Math.round(bytes / MB)} MB`;
const fmtUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
};

type Row = { label: string; value: string; pct?: number };

export default function StatusPage() {
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const heapLimit = heap.heap_size_limit;
  const heapUsedPct = (memory.heapUsed / heapLimit) * 100;
  const heapTotalPct = (memory.heapTotal / heapLimit) * 100;

  const rows: Row[] = [
    { label: 'Heap used', value: fmtMB(memory.heapUsed), pct: heapUsedPct },
    { label: 'Heap allocated', value: fmtMB(memory.heapTotal), pct: heapTotalPct },
    { label: 'Heap limit (V8 max-old-space)', value: fmtMB(heapLimit) },
    { label: 'RSS (process resident)', value: fmtMB(memory.rss) },
    { label: 'External (C++ buffers)', value: fmtMB(memory.external) },
    { label: 'Array buffers', value: fmtMB(memory.arrayBuffers) }
  ];

  const meta = [
    { label: 'Service', value: 'debug-console' },
    { label: 'Version', value: process.env.KATANA_ARTIFACT_VERSION?.substring(0, 7) || 'unknown' },
    { label: 'Environment', value: process.env.NODE_ENV || 'production' },
    { label: 'Node', value: process.version },
    { label: 'PID', value: String(process.pid) },
    { label: 'Uptime', value: fmtUptime(process.uptime()) },
    { label: 'Timestamp', value: new Date().toISOString() }
  ];

  const pageStyle: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#111',
    padding: '24px'
  };

  return (
    <>
      <title>Status — debug-console</title>
      <meta httpEquiv="refresh" content="5" />
      <meta name="robots" content="noindex" />
      <div style={pageStyle}>
        <h1 style={{ fontSize: '20px', marginBottom: '4px' }}>debug-console status</h1>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '24px' }}>
          Auto-refreshes every 5s. No auth required.
        </div>

        <section style={{ marginBottom: '24px' }}>
          <h2 style={{ fontSize: '14px', marginBottom: '8px' }}>Process</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              {meta.map((m) => (
                <tr key={m.label}>
                  <td style={{ padding: '2px 16px 2px 0', color: '#666' }}>{m.label}</td>
                  <td style={{ padding: '2px 0' }}>{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 style={{ fontSize: '14px', marginBottom: '8px' }}>Memory</h2>
          <table style={{ borderCollapse: 'collapse', fontSize: '13px', width: '520px' }}>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ padding: '4px 16px 4px 0', color: '#666', verticalAlign: 'top' }}>{r.label}</td>
                  <td style={{ padding: '4px 16px 4px 0', verticalAlign: 'top' }}>{r.value}</td>
                  <td style={{ padding: '4px 0', verticalAlign: 'top', width: '240px' }}>
                    {r.pct !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            width: '180px',
                            height: '8px',
                            background: '#eee',
                            borderRadius: '2px',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, r.pct)}%`,
                              height: '100%',
                              background: r.pct > 85 ? '#d22' : r.pct > 70 ? '#d80' : '#2a7'
                            }}
                          />
                        </div>
                        <span style={{ color: '#666', fontSize: '12px' }}>{r.pct.toFixed(1)}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div style={{ marginTop: '24px', fontSize: '12px', color: '#888' }}>
          Machine-readable: <a href="/api/health?detailed=true" style={{ color: '#36c' }}>/api/health?detailed=true</a>
        </div>
      </div>
    </>
  );
}
