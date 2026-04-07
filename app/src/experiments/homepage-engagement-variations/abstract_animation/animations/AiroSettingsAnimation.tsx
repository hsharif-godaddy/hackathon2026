import './AiroSettingsAnimation.scss';

import { type FC, type ReactNode, useEffect, useMemo, useRef } from 'react';

import { wait } from '@/experiments/homepage-engagement-variations/abstract_animation/animations/utils';
import { useTranslations } from '@/hooks/useTranslations';

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

export interface AiroSettingsAnimationProps {
  className?: string;
}

// ────────────────────────────────────────
// SVG Icons (14×14 feather-style)
// ────────────────────────────────────────

const sp = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const ICO = {
  gear:     <svg {...sp}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  link:     <svg {...sp}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
  clock:    <svg {...sp}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  shield:   <svg {...sp}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  users:    <svg {...sp}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  database: <svg {...sp}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
  key:      <svg {...sp}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>,
  share:    <svg {...sp}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>,
  chart:    <svg {...sp}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>,
  volume:   <svg {...sp}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>,
  heart:    <svg {...sp}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>,
  download: <svg {...sp}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  edit:     <svg {...sp}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  table:    <svg {...sp}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></svg>,
  check:    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  calendar: <svg {...sp}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  extLinkSm:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>,
  folder:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
  caret:    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>,
};

// ────────────────────────────────────────
// Sidebar items
// ────────────────────────────────────────

interface SidebarEntry { id: string; label: string; icon: ReactNode }

const PANELS = ['domain', 'backups', 'database'] as const;

// ────────────────────────────────────────
// Component
// ────────────────────────────────────────

export const AiroSettingsAnimation: FC<AiroSettingsAnimationProps> = ({
  className = '',
}) => {
  const t = useTranslations();
  const rootRef = useRef<HTMLDivElement>(null);

  const sidebar = useMemo<SidebarEntry[]>(() => [
    { id: 'project',  label: t('builder_abstract_animation_settings_sidebar_project'),   icon: ICO.gear },
    { id: 'domain',   label: t('builder_abstract_animation_settings_sidebar_domain'),    icon: ICO.link },
    { id: 'backups',  label: t('builder_abstract_animation_settings_sidebar_backups'),   icon: ICO.clock },
    { id: 'security', label: t('builder_abstract_animation_settings_sidebar_security'),  icon: ICO.shield },
    { id: 'delegate', label: t('builder_abstract_animation_settings_sidebar_delegate'),  icon: ICO.users },
    { id: 'database', label: t('builder_abstract_animation_settings_sidebar_database'),  icon: ICO.database },
    { id: 'secrets',  label: t('builder_abstract_animation_settings_sidebar_secrets'),   icon: ICO.key },
    { id: 'social',   label: t('builder_abstract_animation_settings_sidebar_social'),    icon: ICO.share },
    { id: 'analytics',label: t('builder_abstract_animation_settings_sidebar_analytics'), icon: ICO.chart },
    { id: 'marketing',label: t('builder_abstract_animation_settings_sidebar_marketing'), icon: ICO.volume },
    { id: 'feedback', label: t('builder_abstract_animation_settings_sidebar_feedback'),  icon: ICO.heart },
  ], [t]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const root = rootRef.current;
    if (!root) return;

    function setActivePanel(panelId: string) {
      root!.querySelectorAll<HTMLElement>('.stg-sidebar-item').forEach((item) => {
        item.classList.toggle('active', item.getAttribute('data-id') === panelId);
      });
      root!.querySelectorAll<HTMLElement>('.stg-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.getAttribute('data-panel') === panelId);
      });
    }

    async function run() {
      // Start on domain, then cycle through panels
      await wait(3000);
      if (signal.aborted) return;

      while (!signal.aborted) {
        for (const panelId of PANELS) {
          if (signal.aborted) return;
          setActivePanel(panelId);
          await wait(3000);
        }
      }
    }

    run();
    return () => controller.abort();
  }, []);

  return (
    <div className={`airo-settings ${className}`.trim()} ref={rootRef}>

      {/* ── Header ── */}
      <div className="stg-header">
        <span className="stg-project-name">{t('builder_abstract_animation_settings_project_name')}</span>
      </div>

      {/* ── Body: Sidebar + Content ── */}
      <div className="stg-body">
        <div className="stg-settings-sidebar">
          {sidebar.map((item) => (
            <div
              key={item.id}
              className={`stg-sidebar-item${item.id === 'domain' ? ' active' : ''}`}
              data-id={item.id}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="stg-settings-content">

          {/* Domain Panel */}
          <div className="stg-panel active" data-panel="domain">
            <div className="stg-panel-header">
              <div className="stg-panel-title">{t('builder_abstract_animation_settings_domain_title')}</div>
              <span className="stg-badge stg-badge-green">{'\u25cf'} {t('builder_abstract_animation_settings_domain_badge_ready')}</span>
            </div>
            <div className="stg-panel-desc">{t('builder_abstract_animation_settings_domain_description')}</div>
            <div className="stg-label">{t('builder_abstract_animation_settings_domain_label_name')}</div>
            <div className="stg-input">my-coffee-site</div>
            <div className="stg-input-hint">{t('builder_abstract_animation_settings_domain_input_hint')}</div>
            <span className="stg-link">https://my-coffee-site.airoapp.ai {ICO.extLinkSm}</span>

            <hr className="stg-section-divider" />

            <div className="stg-panel-header">
              <div className="stg-panel-title">{t('builder_abstract_animation_settings_custom_domain_title')}</div>
              <button className="stg-btn-accent" type="button">{t('builder_abstract_animation_settings_custom_domain_buy')}</button>
            </div>
            <div className="stg-panel-desc">{t('builder_abstract_animation_settings_custom_domain_description')}</div>

            {['mycoffeesite.example', 'my-coffee-site.example', 'demo-mycoffee.example'].map((d) => (
              <div key={d} className="stg-domain-row"><span>{d}</span><span className="stg-dots-menu">{'\u22ee'}</span></div>
            ))}
          </div>

          {/* Backups Panel */}
          <div className="stg-panel" data-panel="backups">
            <div className="stg-card">
              <div className="stg-panel-title" style={{ marginBottom: 12 }}>{t('builder_abstract_animation_settings_backups_schedule_title')}</div>
              <div className="stg-backup-grid">
                <div className="stg-backup-col">
                  <span className="stg-badge stg-badge-green">{t('builder_abstract_animation_settings_backups_badge_completed')}</span>
                  <div className="stg-label" style={{ marginTop: 6, marginBottom: 0 }}>{t('builder_abstract_animation_settings_backups_label_last')}</div>
                  <div className="stg-backup-date">{t('builder_abstract_animation_settings_backups_last_date')}</div>
                  <div className="stg-backup-sub">{t('builder_abstract_animation_settings_backups_last_time')}</div>
                </div>
                <div className="stg-backup-col">
                  <span className="stg-badge stg-badge-gray">{t('builder_abstract_animation_settings_backups_badge_pending')}</span>
                  <div className="stg-label" style={{ marginTop: 6, marginBottom: 0 }}>{t('builder_abstract_animation_settings_backups_label_next')}</div>
                  <div className="stg-backup-date">{t('builder_abstract_animation_settings_backups_next_date')}</div>
                </div>
              </div>
            </div>

            <div className="stg-panel-title">{t('builder_abstract_animation_settings_backups_history_title')}</div>
            <div className="stg-label" style={{ marginTop: 6 }}>{t('builder_abstract_animation_settings_backups_view_date')}</div>
            <div className="stg-date-picker">{ICO.calendar} {t('builder_abstract_animation_settings_backups_last_date')}</div>

            <div className="stg-tab-bar">
              <div className="stg-tab active">{t('builder_abstract_animation_settings_backups_tab_files')}</div>
            </div>

            <div className="stg-file-row">
              <div className="stg-checkbox">{ICO.check}</div>
              <span style={{ fontWeight: 600 }}>{t('builder_abstract_animation_settings_backups_select_all')}</span>
            </div>
            <div className="stg-file-row" style={{ paddingLeft: 6 }}>
              <div className="stg-checkbox">{ICO.check}</div>
              <span className="stg-caret">{ICO.caret}</span>
              {ICO.folder}
              <span>{t('builder_abstract_animation_settings_backups_files')}</span>
              <span className="stg-file-size">5.47 MB</span>
            </div>
            <div className="stg-file-row" style={{ paddingLeft: 6 }}>
              <div className="stg-checkbox">{ICO.check}</div>
              <span className="stg-caret">{ICO.caret}</span>
              {ICO.database}
              <span>{t('builder_abstract_animation_settings_backups_databases')}</span>
              <span className="stg-file-size">4.8 kB</span>
            </div>
            <button className="stg-btn-outline" type="button">{'\u21bb'} {t('builder_abstract_animation_settings_backups_restore')}</button>
          </div>

          {/* Database Panel */}
          <div className="stg-panel" data-panel="database">
            <div className="stg-panel-title">{t('builder_abstract_animation_settings_database_title')}</div>
            <div className="stg-panel-desc">
              {t('builder_abstract_animation_settings_database_description')}
            </div>
            {['Account', 'Session', 'User', 'Verification'].map((name) => (
              <div key={name} className="stg-table-row">
                <span className="stg-table-icon">{ICO.table}</span>
                <span>{name}</span>
                <div className="stg-table-actions">
                  <span className="stg-table-action">{ICO.download}</span>
                  <span className="stg-table-action">{ICO.edit} {t('builder_abstract_animation_settings_database_edit')}</span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>

    </div>
  );
};

export default AiroSettingsAnimation;
