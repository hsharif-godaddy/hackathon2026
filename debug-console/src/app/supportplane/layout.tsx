import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'AAB | Support Plane',
    description: 'L1 transcript ingestion, trend analysis, and support intelligence dashboard.',
    icons: {
        icon: '/supportplane/icon.svg',
    },
};

export default function SupportPlaneLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
