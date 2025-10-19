'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { DatabasePanel } from './settings/DatabasePanel'
import { EnvironmentPanel } from './settings/EnvironmentPanel'
import { DeploymentPanel } from './settings/DeploymentPanel'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '@/lib/shadcn/sidebar'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  defaultSection?: 'database' | 'environment' | 'deployment'
  appId: string
}

type SettingsSection =
  | 'database-connection'
  | 'database-schema'
  | 'database-actions'
  | 'environment'
  | 'deployment'

export default function SettingsDialog({
  isOpen,
  onClose,
  defaultSection = 'database',
  appId
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('database-connection')

  // Update active section when defaultSection changes
  useEffect(() => {
    if (isOpen && defaultSection) {
      // Map default sections to specific views
      if (defaultSection === 'database') {
        setActiveSection('database-connection')
      } else {
        setActiveSection(defaultSection as SettingsSection)
      }
    }
  }, [isOpen, defaultSection])

  // Handle ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Dialog container */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-background rounded-lg shadow-lg w-full max-w-6xl h-[85vh] flex flex-col pointer-events-auto relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>

          {/* Content with Sidebar */}
          <SidebarProvider defaultOpen={true} className="flex-1 min-h-0">
            <div className="flex h-full overflow-hidden">
              {/* Sidebar navigation */}
              <Sidebar collapsible="none" className="border-r">
                <SidebarHeader>
                  <h2 className="px-4 py-4 text-lg font-semibold">Application Settings</h2>
                </SidebarHeader>
                <SidebarContent className="overflow-y-auto">
                  {/* Database Group */}
                  <SidebarGroup>
                    <SidebarGroupLabel>Database</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={() => setActiveSection('database-connection')}
                            isActive={activeSection === 'database-connection'}
                          >
                            <span>Connection</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={() => setActiveSection('database-schema')}
                            isActive={activeSection === 'database-schema'}
                          >
                            <span>Schema</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={() => setActiveSection('database-actions')}
                            isActive={activeSection === 'database-actions'}
                          >
                            <span>Actions</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>

                  <SidebarSeparator />

                  {/* Environment Group */}
                  <SidebarGroup>
                    <SidebarGroupLabel>Environment</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={() => setActiveSection('environment')}
                            isActive={activeSection === 'environment'}
                          >
                            <span>Variables</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>

                  <SidebarSeparator />

                  {/* Deployment Group */}
                  <SidebarGroup>
                    <SidebarGroupLabel>Deployment</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={() => setActiveSection('deployment')}
                            isActive={activeSection === 'deployment'}
                          >
                            <span>Configuration</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                </SidebarContent>
              </Sidebar>

              {/* Content area */}
              <div className="flex-1 overflow-y-auto">
                {(activeSection === 'database-connection' ||
                  activeSection === 'database-schema' ||
                  activeSection === 'database-actions') && (
                  <DatabasePanel
                    appId={appId}
                    section={activeSection.replace('database-', '') as 'connection' | 'schema' | 'actions'}
                  />
                )}

                {activeSection === 'environment' && (
                  <EnvironmentPanel appId={appId} />
                )}

                {activeSection === 'deployment' && (
                  <DeploymentPanel appId={appId} />
                )}
              </div>
            </div>
          </SidebarProvider>
        </div>
      </div>
    </>
  )
}
