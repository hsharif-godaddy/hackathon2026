'use client';

import { ChevronLeft } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';
import ServiceHealthBar from '@/components/supportplane/ServiceHealthBar';
import ThemeToggle from '@/components/supportplane/ThemeToggle';
import { PANEL_LABELS } from '@/components/supportplane/types';
import type { PanelId } from '@/components/supportplane/types';
import { userDisplay, userInitials } from '@/components/supportplane/utils';

export default function Header({ panel, isDark, email, onToggle }: {
    panel: PanelId; isDark: boolean; email: string | undefined; onToggle: () => void;
}) {
    const parts = PANEL_LABELS[panel].split(' — ');
    return (
        <header className={sp.header}>
            <div className={sp.headerLeft}>
                <span className={sp.panelBreadcrumb}>
                    {parts.length > 1
                        ? <>{parts[0]}<span className={sp.breadcrumbSep}>/</span><span className={sp.breadcrumbLeaf}>{parts[1]}</span></>
                        : <span className={sp.breadcrumbLeaf}>{parts[0]}</span>
                    }
                </span>
            </div>
            <ServiceHealthBar />
            <div className={sp.headerRight}>
                <ThemeToggle isDark={isDark} onToggle={onToggle} />
                <a href="/" className={sp.backBtn}><ChevronLeft size={13} />Dashboard</a>
                <div className={sp.userChip}>
                    <div className={sp.userAvatar}>{userInitials(email)}</div>
                    <span className={sp.userName}>{userDisplay(email)}</span>
                </div>
            </div>
        </header>
    );
}
