'use client'

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  PlayIcon
} from '@heroicons/react/24/outline'
import { PlanItem } from './types'

interface PlanTrackerProps {
  developmentPlan: PlanItem[]
  expandedPlan: boolean
  onToggleExpandedPlan: () => void
}

export default function PlanTracker({
  developmentPlan,
  expandedPlan,
  onToggleExpandedPlan
}: PlanTrackerProps) {
  const getCurrentActiveItem = () => {
    return developmentPlan.find(item => item.status === 'in_progress') || developmentPlan[0]
  }

  const activeItem = getCurrentActiveItem()

  // Don't render if there are no plan items
  if (!activeItem) {
    return null
  }

  return (
    <>
      {/* Plan Status Bar */}
      <div className="bg-white border-b border-gray-200">
        <button
          onClick={onToggleExpandedPlan}
          className="w-full flex items-center justify-between px-2 py-1 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center min-w-0 flex-1">
            <div className="w-2 h-2 bg-green-500 rounded-full flex items-center justify-center mr-1 flex-shrink-0">
              <PlayIcon className="w-1 h-1 text-white" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-900 truncate">{activeItem.title}</p>
            </div>
          </div>
          <div className="flex items-center space-x-1 flex-shrink-0">
            <div className="text-xs text-gray-600">3/7</div>
            {expandedPlan ? (
              <ChevronUpIcon className="w-1.5 h-1.5 text-gray-500" />
            ) : (
              <ChevronDownIcon className="w-1.5 h-1.5 text-gray-500" />
            )}
          </div>
        </button>
      </div>

      {/* Drawer Content */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
        expandedPlan ? 'max-h-48' : 'max-h-0'
      }`}>
        <div className="bg-gray-50 border-b border-gray-200">
          <div className="p-2 space-y-2">
            {/* Active Plan Details */}
            <div className="bg-white rounded-lg p-2 shadow-sm">
              <div className="flex items-start justify-between mb-1.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{activeItem.title}</h3>
                  <p className="text-xs text-gray-700 mt-0.5">{activeItem.description}</p>
                </div>
                <div className="flex items-center space-x-0.5 text-xs">
                  <span>Est. {activeItem.estimatedTime}</span>
                </div>
              </div>

              {/* Tasks */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-800">Current Tasks:</p>
                {activeItem.tasks.map((task, index) => (
                  <div key={index} className="flex items-center text-xs text-gray-700">
                    <CheckCircleIcon className="w-1.5 h-1.5 text-green-500 mr-1 flex-shrink-0" />
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Overview */}
            <div className="bg-white rounded-lg p-2 shadow-sm">
              <h4 className="text-sm font-medium text-gray-900 mb-1.5">Development Progress</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">3</div>
                  <div className="text-xs">Complete</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">1</div>
                  <div className="text-xs">In Progress</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-400">3</div>
                  <div className="text-xs">Pending</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                  <span>Overall Progress</span>
                  <span>43%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div className="bg-green-500 h-1 rounded-full" style={{ width: '43%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
