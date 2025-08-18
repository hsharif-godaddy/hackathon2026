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
          className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center min-w-0 flex-1">
            <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center mr-2 flex-shrink-0">
              <PlayIcon className="w-2 h-2 text-white" />
            </div>
            <div className="text-left min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-900 truncate">{activeItem.title}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div className="text-xs text-gray-600">3/7</div>
            {expandedPlan ? (
              <ChevronUpIcon className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronDownIcon className="w-3 h-3 text-gray-500" />
            )}
          </div>
        </button>
      </div>

      {/* Drawer Content */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
        expandedPlan ? 'max-h-96' : 'max-h-0'
      }`}>
        <div className="bg-gray-50 border-b border-gray-200">
          <div className="p-4 space-y-4">
            {/* Active Plan Details */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{activeItem.title}</h3>
                  <p className="text-xs text-gray-700 mt-1">{activeItem.description}</p>
                </div>
                <div className="flex items-center space-x-1 text-xs text-gray-600">
                  <span>Est. {activeItem.estimatedTime}</span>
                </div>
              </div>
              
              {/* Tasks */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-800">Current Tasks:</p>
                {activeItem.tasks.map((task, index) => (
                  <div key={index} className="flex items-center text-xs text-gray-700">
                    <CheckCircleIcon className="w-3 h-3 text-green-500 mr-2 flex-shrink-0" />
                    <span>{task}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Overview */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Development Progress</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-600">3</div>
                  <div className="text-xs text-gray-600">Complete</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-600">1</div>
                  <div className="text-xs text-gray-600">In Progress</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-400">3</div>
                  <div className="text-xs text-gray-600">Pending</div>
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>Overall Progress</span>
                  <span>43%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '43%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
