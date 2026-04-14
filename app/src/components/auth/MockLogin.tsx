'use client'

import { UserIcon } from '@heroicons/react/24/outline'
import Button from '@ux/button'
import Modal from '@ux/modal'

import { useMockAuth } from '@/hooks/useMockAuth'
import { MOCK_USER } from '@/lib/mock-auth'

interface MockLoginDialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message?: string
}

export function MockLoginDialog({
  isOpen,
  onClose,
  title = "Mock Login - Development Only",
  message = "Sign in as a test user to simulate the login experience. This is only available in development mode."
}: MockLoginDialogProps) {
  const { login, isLoading } = useMockAuth()

  if (!isOpen) return null

  const handleLogin = async () => {
    await login()
    onClose()
  }

  return (
    <Modal

      title={title}
      description={message}
      onClose={onClose}
      portalElem={document.body}
      actions={
        <>
          <Button
            design="secondary"
            onClick={onClose}
            text="Close"
          />
          <Button
            design="primary"
            disabled={isLoading}
            onClick={handleLogin}
            text="Mock Login"
          />
        </>
      }
    >
      <div>
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Test User:
          </label>
          <div className="flex items-center px-2 py-1.5 border border-gray-300 rounded-lg bg-gray-50">
            <span className="text-2xl mr-1.5">{MOCK_USER.avatar}</span>
            <div className="text-left">
              <div className="font-medium text-gray-900">{MOCK_USER.name}</div>
              <div className="text-sm text-gray-500">{MOCK_USER.email}</div>
              <div className="text-xs text-purple-600 font-medium">Plan: {MOCK_USER.plan}</div>
            </div>
          </div>
        </div>

        {/* Plan Info */}
        <div className="bg-purple-50 rounded-lg p-1.5 mb-2">
          <div className="flex items-center">
            <UserIcon className="w-2 h-2 text-purple-600 mr-1" />
            <span className="text-sm font-medium text-purple-900">
              Development User: {MOCK_USER.plan} Plan
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
