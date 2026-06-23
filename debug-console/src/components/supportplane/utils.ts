export function userInitials(email: string | undefined): string {
    if (!email) return '?';
    const name = (email.split('@')[0] ?? '').replace(/[._-]/g, ' ');
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

export function userDisplay(email: string | undefined): string {
    if (!email) return 'unknown';
    return (email.split('@')[0] ?? email).toLowerCase();
}

export function seeded(seed: number, min: number, max: number): number {
    const x = Math.sin(seed + 1) * 10000;
    return Math.floor((x - Math.floor(x)) * (max - min + 1)) + min;
}
