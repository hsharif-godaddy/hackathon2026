'use client'

import clsx from 'clsx'
import { type ReactElement, useState } from 'react'
import { isEmployeeAuthType } from '@airo/shared/auth'
import Button from '@ux/button'
import CheckmarkIcon from '@ux/icon/checkmark'
import ExperimentIcon from '@ux/icon/experiment'
import Modal from '@ux/modal'

import { useAuthContext } from '@/components/providers/AuthProvider'
import {
  AGENT_SELECTIONS,
  PROFILE_SELECTIONS,
  type StartSelection,
  TEMPLATE_SELECTIONS,
} from '@/config/start-as-catalog'
import { useSwitchboard } from '@/hooks/useSwitchboard'

interface StartAsControlsProps {
  /** Profile axis (`?profile=`): sets session model/skills + default initial. */
  selectedProfile: string
  onProfileChange: (profile: string) => void
  /** Freeze axis, encoded `template:<id>` | `agent:<id>` | `''` (`?template=` XOR `?agent=`). */
  selectedStartOverride: string
  onStartOverrideChange: (encoded: string) => void
}

interface StartOptionRow {
  /** The value written to the axis (`''` = default, or a profile name / `template:<id>` / `agent:<id>`). */
  value: string
  label: string
  /** Registered id shown in mono for code tracing; omitted on the "default" row. */
  id?: string
  description: string
}

/** Turn a catalog entry into a row, encoding the freeze axis with its `template:` / `agent:` prefix. */
function toRow(selection: StartSelection, prefix?: 'template' | 'agent'): StartOptionRow {
  return {
    value: prefix ? `${prefix}:${selection.value}` : selection.value,
    label: selection.label,
    id: selection.value,
    description: selection.description,
  }
}

function OptionButton({
  row,
  selected,
  onSelect,
}: {
  row: StartOptionRow
  selected: boolean
  onSelect: (value: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(row.value)}
      className={clsx(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        selected ? 'bg-ai/10' : 'hover:bg-intents-ux-boxLowContrast-backgroundColor',
      )}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {selected && <CheckmarkIcon width={16} height={16} className="text-ai" aria-hidden="true" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium leading-tight">{row.label}</span>
          {row.id && (
            <span className="font-mono text-xs text-intents-ux-textLowContrast-color">{row.id}</span>
          )}
        </span>
        <span className="text-xs leading-snug text-intents-ux-textLowContrast-color">{row.description}</span>
      </span>
    </button>
  )
}

/** Prominent per-axis heading (Profile / Start as) — outranks the muted sub-group labels below. */
function AxisHeader({ children }: { children: string }): ReactElement {
  return <div className="px-2 pb-1 pt-1 text-sm font-semibold">{children}</div>
}

/** Muted sub-group label within an axis (Templates / Agents). */
function SubGroupLabel({ children }: { children: string }): ReactElement {
  return (
    <div className="px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-intents-ux-textLowContrast-color">
      {children}
    </div>
  )
}

/** Plain-English helper text under an axis heading, for non-engineer internal users. */
function AxisDescription({ children }: { children: string }): ReactElement {
  return <p className="px-2 pb-2 text-xs leading-snug text-intents-ux-textLowContrast-color">{children}</p>
}

/** Plain-English helper text under a sub-group label. */
function SubGroupDescription({ children }: { children: string }): ReactElement {
  return <p className="px-2 pb-1 text-[11px] leading-snug text-intents-ux-textLowContrast-color">{children}</p>
}

/**
 * Internal-only "start-as" controls for the home page — two independent axes:
 *  - Profile (the proper abstraction): session config + default initial → `?profile=`.
 *  - Start-as freeze: pin the initial agent by Template or Agent (mutually
 *    exclusive) → `?template=` / `?agent=`.
 *
 * Opened from an experiment icon in the prompt input row into a wide centered
 * dialog laid out as columns (Profile | Start as → Templates + Agents) so the
 * whole catalog is visible with little scrolling. Each option shows its name,
 * registered id, and description so internal teams can trace it back to code.
 * Rendered only for internal users (impersonation or the
 * `appbuilder-agent-start-override` flag). The server independently gates +
 * validates every param, so a non-internal user has no effect.
 */
export default function StartAsControls({
  selectedProfile,
  onProfileChange,
  selectedStartOverride,
  onStartOverrideChange,
}: StartAsControlsProps): ReactElement | null {
  const [open, setOpen] = useState<boolean>(false)
  const { authState } = useAuthContext()
  const isImpersonating = isEmployeeAuthType((authState as { authType?: string } | null | undefined)?.authType)
  const flagEnabled = useSwitchboard('appbuilder-agent-start-override')
  const isEnabled = isImpersonating || flagEnabled

  if (!isEnabled) return null

  const hasSelection: boolean = selectedProfile !== '' || selectedStartOverride !== ''
  const profileDefault: StartOptionRow = {
    value: '',
    label: 'Default profile',
    description: 'Use the default profile — applied for the whole app lifetime.',
  }
  const overrideDefault: StartOptionRow = {
    value: '',
    label: 'Default (from profile)',
    description: "Don't pin an initial agent — inherit it from the profile.",
  }

  return (
    <>
      <Button
        design={hasSelection ? 'primary' : 'tertiary'}
        size="sm"
        icon={<ExperimentIcon />}
        aria-label="Start-as controls (internal)"
        data-testid="start-as-controls"
        onClick={() => setOpen(true)}
      />
      {open && (
        <Modal
          title="Internal · start a new app as"
          id="start-as-modal"
          onClose={() => setOpen(false)}
          ariaLabels={{ close: 'Close start-as controls' }}
          stretch
        >
          <div className="flex w-full flex-col gap-3" data-testid="start-as-panel">
            <p className="text-xs leading-snug text-intents-ux-textLowContrast-color">
              Overrides for how a new app&apos;s build begins. The two settings are independent — leave them on their defaults for the normal customer experience. The server validates and ignores these for non-internal users.
            </p>
            <div className="flex w-full gap-4">
              <div
                role="listbox"
                aria-label="Profile (internal)"
                data-testid="start-as-profile"
                className="flex min-w-0 flex-1 flex-col"
              >
                <AxisHeader>Profile</AxisHeader>
                <AxisDescription>
                  The overall build strategy — which llm model version (sonnet-4.5, opus-5, gpt-4, ...), skills, and question flow the app uses. Baked in when the app is created and applied for its whole lifetime (not just this login). This is the main setting; most of what you&apos;d want to change lives here.
                </AxisDescription>
                <div className="flex max-h-[56vh] flex-col overflow-y-auto">
                  <OptionButton row={profileDefault} selected={selectedProfile === ''} onSelect={onProfileChange} />
                  {PROFILE_SELECTIONS.map(profile => (
                    <OptionButton
                      key={profile.value}
                      row={toRow(profile)}
                      selected={selectedProfile === profile.value}
                      onSelect={onProfileChange}
                    />
                  ))}
                </div>
              </div>

              <div className="w-0 self-stretch border-l border-intents-ux-box-borderColor" />

              <div
                role="listbox"
                aria-label="Start as (internal)"
                data-testid="start-as-override"
                className="flex min-w-0 flex-[2] flex-col"
              >
                <AxisHeader>Start as</AxisHeader>
                <AxisDescription>
                  Advanced. Pins the exact first agent the build begins with instead of letting the profile decide. Pick one option from Templates or Agents (not both).
                </AxisDescription>
                <OptionButton
                  row={overrideDefault}
                  selected={selectedStartOverride === ''}
                  onSelect={onStartOverrideChange}
                />
                <div className="flex min-w-0 gap-4">
                  <div role="group" aria-label="Templates" className="flex min-w-0 flex-1 flex-col">
                    <SubGroupLabel>Templates</SubGroupLabel>
                    <SubGroupDescription>
                      Pre-built flows tuned for a specific outcome (logo, business plan, deep build…).
                    </SubGroupDescription>
                    <div className="flex max-h-[48vh] flex-col overflow-y-auto">
                      {TEMPLATE_SELECTIONS.map(template => {
                        const row: StartOptionRow = toRow(template, 'template')
                        return (
                          <OptionButton
                            key={row.value}
                            row={row}
                            selected={selectedStartOverride === row.value}
                            onSelect={onStartOverrideChange}
                          />
                        )
                      })}
                    </div>
                  </div>
                  <div role="group" aria-label="Agents" className="flex min-w-0 flex-1 flex-col">
                    <SubGroupLabel>Agents</SubGroupLabel>
                    <SubGroupDescription>
                      Jump straight to one specific agent — the most advanced option, mainly for debugging.
                    </SubGroupDescription>
                    <div className="flex max-h-[48vh] flex-col overflow-y-auto">
                      {AGENT_SELECTIONS.map(agent => {
                        const row: StartOptionRow = toRow(agent, 'agent')
                        return (
                          <OptionButton
                            key={row.value}
                            row={row}
                            selected={selectedStartOverride === row.value}
                            onSelect={onStartOverrideChange}
                          />
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
