'use client'

import { BookOpen, Package } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Pagination from '@ux/pagination'
import TextInput from '@ux/text-input'

import { logger } from '@/lib/request-context'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import ToolHeader from './ToolHeader'
import ToolModal from './ToolModal'

/**
 * Skill data structure
 */
interface Skill {
  name: string
  description?: string
}

/**
 * Result from skill list action
 */
interface SkillListResult {
  count: number
  skills: Skill[]
}

/**
 * Result from skill load action
 */
interface SkillLoadResult {
  skill: string
}

/**
 * Result of a single dependency installation
 */
interface DependencyInstallResult {
  package: string
  success: boolean
  error?: string
  retries: number
}

/**
 * Result from skill install action
 */
interface SkillInstallResult {
  skill: string
  filesInstalled: number
  installedFiles: string[]
  dependenciesInstalled?: DependencyInstallResult[]
  dependenciesFailed?: number
  skillDependenciesInstalled?: string[]
}

/**
 * Union type for all skill result types
 */
type SkillResult = SkillListResult | SkillLoadResult | SkillInstallResult

/**
 * Skill action input
 */
interface SkillInput {
  action: 'list' | 'load' | 'install'
  skill?: string
}

/**
 * Constants
 */
const SKILLS_PER_PAGE = 5

/**
 * Progress phases shown while a skill install is running.
 * Each entry is [message, duration in ms before advancing].
 */
const INSTALL_PROGRESS_PHASES: [string, number][] = [
  ['Installing templates', 2000],
  ['Installing packages', 8000],
  ['Configuring dependencies', 6000],
  ['Finishing up', 0], // stays here until complete
]

/**
 * Cycles through install progress phases while the tool is running.
 */
function useInstallProgress(isRunning: boolean): string {
  const [phaseIndex, setPhaseIndex] = useState(0)

  useEffect(() => {
    if (!isRunning) {
      setPhaseIndex(0)
      return
    }

    const [, duration] = INSTALL_PROGRESS_PHASES[phaseIndex]
    if (duration === 0) return // last phase, stay here

    const timer = setTimeout(() => {
      setPhaseIndex(i => Math.min(i + 1, INSTALL_PROGRESS_PHASES.length - 1))
    }, duration)

    return () => clearTimeout(timer)
  }, [isRunning, phaseIndex])

  return INSTALL_PROGRESS_PHASES[phaseIndex][0]
}

/**
 * Format skill name - capitalize each word and split on hyphens
 * Example: "blog-writing" -> "Blog Writing"
 */
function formatSkillName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get display message based on skill action and result
 */
function getSkillMessage(action: string, result: SkillResult | null): { message: string; icon: React.ReactNode } {
  switch (action) {
    case 'list': {
      const count = (result && 'count' in result) ? result.count : 0
      return {
        message: `Found ${count} available ${count === 1 ? 'skill' : 'skills'}`,
        icon: <BookOpen className="w-2 h-2" />
      }
    }
    case 'load': {
      const skillName = (result && 'skill' in result) ? result.skill : 'Unknown'
      return {
        message: `Loaded skill: ${formatSkillName(skillName)}`,
        icon: <BookOpen className="w-2 h-2" />
      }
    }
    case 'install': {
      const filesCount = (result && 'filesInstalled' in result) ? result.filesInstalled : 0
      const installSkillName = (result && 'skill' in result) ? result.skill : 'skill'
      const depsInstalled = (result && 'dependenciesInstalled' in result) ? result.dependenciesInstalled : undefined
      const successCount = depsInstalled ? depsInstalled.filter(d => d.success).length : 0
      const depInfo = successCount > 0 ? `, ${successCount} ${successCount === 1 ? 'package' : 'packages'}` : ''
      return {
        message: `Installed ${formatSkillName(installSkillName)} (${filesCount} ${filesCount === 1 ? 'file' : 'files'}${depInfo})`,
        icon: <Package className="w-2 h-2" />
      }
    }
    default:
      return {
        message: 'Skill',
        icon: <BookOpen className="w-2 h-2" />
      }
  }
}

/**
 * Render skill list with search and pagination
 */
function SkillListContent({ skills }: { skills: Skill[] }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = SKILLS_PER_PAGE

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills

    const query = searchQuery.toLowerCase()
    return skills.filter(skill =>
      skill.name.toLowerCase().includes(query) ||
      (skill.description && skill.description.toLowerCase().includes(query))
    )
  }, [skills, searchQuery])

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  // Calculate pagination
  const totalItems = filteredSkills.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedSkills = filteredSkills.slice(startIndex, endIndex)

  const handlePageChange = (newOffset: number) => {
    const newPage = Math.floor(newOffset / itemsPerPage) + 1
    setCurrentPage(newPage)
  }

  if (!skills || skills.length === 0) {
    return <div className="text-sm text-muted-foreground">No skills available.</div>
  }

  return (
    <div className="space-y-2">
      {/* Header with count */}
      <div className="text-sm text-muted-foreground">
        {filteredSkills.length === skills.length
          ? `${totalItems} ${totalItems === 1 ? 'skill' : 'skills'}`
          : `${filteredSkills.length} of ${skills.length} skills`
        }
        {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
      </div>

      {/* Search box */}
      <TextInput
        visualSize="sm"
        className="w-full"
        id="skill-search-input"
        label={null}
        placeholder="Search skills..."
        aria-label="Search skills by name or description"
        value={searchQuery}
        onChange={(value: string) => setSearchQuery(value)}
      />

      {/* Skills grid - compact layout */}
      {filteredSkills.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-1.5">
            {paginatedSkills.map((skill) => (
              <div
                key={skill.name}
                className="bg-intents-ux-boxLowContrast-backgroundColor hover:bg-intents-ux-boxLowContrast-backgroundColor/80 rounded-md p-1.5 transition-colors"
              >
                <div className="flex items-start gap-1.5">
                  <div className="flex-shrink-0 mt-0.5">
                    <BookOpen className="w-2.5 h-2.5 text-foreground/60" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-foreground">{formatSkillName(skill.name)}</h3>
                    {skill.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center pt-1">
              <Pagination
                limit={itemsPerPage}
                offset={(currentPage - 1) * itemsPerPage}
                total={totalItems}
                onChange={handlePageChange}
                atStart={currentPage === 1}
                atEnd={currentPage === totalPages}
              />
            </div>
          )}
        </>
      ) : (
        <div className="text-center text-muted-foreground py-4 text-sm">
          No skills match &apos;{searchQuery}&apos;
        </div>
      )}
    </div>
  )
}

/**
 * Render skill list as HTML
 */
function renderSkillList(skills: Skill[]): React.JSX.Element {
  return <SkillListContent skills={skills} />
}

/**
 * Render skill load result as HTML
 */
function renderSkillLoad(skillName: string): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-foreground/60" />
        <h2 className="text-lg font-semibold text-foreground">{formatSkillName(skillName)}</h2>
      </div>
      <div className="text-sm text-muted-foreground mb-2">
        Skill instructions loaded into context
      </div>
    </div>
  )
}

/**
 * Render skill install result as HTML
 */
function renderSkillInstall(
  skillName: string,
  filesInstalled: number,
  installedFiles: string[],
  dependenciesInstalled?: DependencyInstallResult[],
  skillDependenciesInstalled?: string[]
): React.JSX.Element {
  const succeededPackages = dependenciesInstalled?.filter(d => d.success) || []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-foreground/60" />
        <h2 className="text-lg font-semibold text-foreground">{formatSkillName(skillName)}</h2>
      </div>

      {/* Skill Dependencies Section (from skill-deps) */}
      {skillDependenciesInstalled && skillDependenciesInstalled.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground/70">Dependent skills installed:</div>
          <div className="flex flex-wrap gap-1">
            {skillDependenciesInstalled.map((depSkill, index) => (
              <span key={index} className="text-xs font-mono bg-intents-ux-boxLowContrast-backgroundColor px-1.5 py-0.5 rounded text-foreground/80">
                {depSkill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Packages Section - only show succeeded */}
      {succeededPackages.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground/70">Packages installed:</div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {succeededPackages.map((dep, index) => (
              <span key={index} className="text-xs font-mono bg-intents-ux-boxLowContrast-backgroundColor px-1.5 py-0.5 rounded text-foreground/80">
                {dep.package}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Files Section */}
      {installedFiles && installedFiles.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground/70">
            {filesInstalled} {filesInstalled === 1 ? 'file' : 'files'} installed:
          </div>
          <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded p-1.5 border border-border max-h-32 overflow-y-auto">
            <ul className="space-y-0.5">
              {installedFiles.map((file, index) => (
                <li key={index} className="text-xs font-mono text-foreground/70">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Custom renderer for skill tool
 *
 * Handles three skill actions:
 * - list: Shows available skills with descriptions
 * - load: Shows skill name that was loaded
 * - install: Shows installed files with checkmarks
 */
export default function SkillToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Parse result
  let parsedResult: SkillResult | null = null
  let action = ''
  let inputSkillName = ''

  // Get action and skill name from input
  if (input && typeof input === 'object') {
    const inputObj = input as Partial<SkillInput>
    action = inputObj.action || ''
    inputSkillName = inputObj.skill || ''
  }

  // Progress phases for install action
  const isInstallRunning = action === 'install' && toolStatus === 'running'
  const installProgress = useInstallProgress(isInstallRunning)

  if (result) {
    try {
      if (typeof result === 'string') {
        parsedResult = JSON.parse(result) as SkillResult
      } else if (typeof result === 'object') {
        parsedResult = result as unknown as SkillResult
      }
    } catch (e) {
      logger.error('skill.render.parse_failure', {
        error: e instanceof Error ? e.message : String(e),
        action,
      })
    }
  }

  // Generate display message and icon
  const { message: defaultMessage, icon } = getSkillMessage(action, parsedResult)

  // Override display message with progress text while running
  const skillLabel = formatSkillName(inputSkillName || 'skill')
  let displayMessage = defaultMessage
  if (toolStatus === 'running') {
    if (action === 'install') {
      displayMessage = `Installing ${skillLabel} — ${installProgress}`
    } else if (action === 'list') {
      displayMessage = 'Loading available skills...'
    } else if (action === 'load') {
      displayMessage = `Loading ${skillLabel}...`
    }
  }

  // Generate modal content
  let modalContentElement: React.JSX.Element | null = null
  let hasDetails = false

  if (parsedResult) {
    hasDetails = true
    if (action === 'list' && 'skills' in parsedResult) {
      modalContentElement = renderSkillList(parsedResult.skills)
    } else if (action === 'load' && 'skill' in parsedResult) {
      modalContentElement = renderSkillLoad(parsedResult.skill)
    } else if (action === 'install' && 'skill' in parsedResult) {
      modalContentElement = renderSkillInstall(
        parsedResult.skill,
        'filesInstalled' in parsedResult ? parsedResult.filesInstalled : 0,
        'installedFiles' in parsedResult ? parsedResult.installedFiles : [],
        'dependenciesInstalled' in parsedResult ? parsedResult.dependenciesInstalled : undefined,
        'skillDependenciesInstalled' in parsedResult ? parsedResult.skillDependenciesInstalled : undefined
      )
    }
  }

  const modalTitle = action === 'list'
    ? 'Available Skills'
    : action === 'load'
    ? `Skill Loaded: ${formatSkillName(parsedResult && 'skill' in parsedResult ? parsedResult.skill : '')}`
    : `Skill Installed: ${formatSkillName(parsedResult && 'skill' in parsedResult ? parsedResult.skill : '')}`

  return (
    <div>
      <ToolHeader
        icon={icon}
        displayName={displayMessage}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <ToolModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalTitle}
      >
        <div className="flex-1 overflow-y-auto">
          {modalContentElement}
        </div>
      </ToolModal>
    </div>
  )
}
