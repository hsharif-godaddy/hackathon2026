export function extractCookieValue(header: string | null, name: string): string | null {
    if (!header) return null;
    const parts = header.split(';');
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) {
            return part.slice(eq + 1).trim();
        }
    }
    return null;
}
