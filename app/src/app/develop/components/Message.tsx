'use client'

import Link from 'next/link'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { Message as MessageType } from './types'

interface MessageProps {
  message: MessageType
}

export default function Message({ message }: MessageProps) {
  return (
    <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
      <div className={`max-w-xs w-full ${message.sender === 'user' ? 'order-2' : 'order-1'}`}>
        <div className={`flex items-start space-x-3 ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            message.sender === 'user' 
              ? 'bg-purple-600' 
              : 'bg-gradient-to-r from-green-100 to-emerald-100'
          }`}>
            {message.sender === 'user' ? (
              <span className="text-white text-sm font-medium">U</span>
            ) : (
              <SparklesIcon className="w-4 h-4 text-green-600" />
            )}
          </div>
          <div className={`flex-1 min-w-0 ${message.sender === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block p-3 rounded-lg max-w-full ${
              message.sender === 'user'
                ? 'bg-purple-600 text-white'
                : message.handoff
                ? 'bg-gradient-to-r from-green-50 to-indigo-50 border border-indigo-200'
                : 'bg-gray-100 text-gray-900'
            }`}>
              <div className="overflow-hidden">
                <p className={`text-sm ${message.handoff ? 'truncate' : 'leading-relaxed break-words'}`}>
                  {message.content}
                </p>
              </div>
              {message.handoff && (
                <div className="mt-2 pt-2 border-t border-indigo-200">
                  <Link
                    href={message.handoff.url}
                    className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-medium rounded-lg hover:shadow-lg transition-all duration-200"
                  >
                    <SparklesIcon className="w-3 h-3 mr-1" />
                    {message.handoff.action} with {message.handoff.to}
                  </Link>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-1 truncate">
              {message.timestamp.toLocaleTimeString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
