'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ExamplePromptsProps {
  onPromptClick: (prompt: string) => void
  disabled?: boolean
  className?: string
}

type ToolCategory = 'all' | 'calculator' | 'weather' | 'planning' | 'images' | 'website'

interface ExamplePrompt {
  text: string
  category: ToolCategory
  icon: string
}

const examples: ExamplePrompt[] = [
  // Calculator examples
  {
    text: "Calculate the compound interest on $10,000 invested at 5% annual interest for 3 years, compounded annually. Show your work step by step.",
    category: 'calculator',
    icon: '🧮'
  },
  {
    text: "What's 15% of 2,450 plus the square root of 144?",
    category: 'calculator',
    icon: '🧮'
  },
  
  // Weather examples  
  {
    text: "Weather in Tokyo",
    category: 'weather',
    icon: '🌤️'
  },
  {
    text: "Compare the weather in New York and London today",
    category: 'weather',
    icon: '🌤️'
  },
  
  // Planning examples
  {
    text: "Plan a weekend trip to Paris",
    category: 'planning',
    icon: '📋'
  },
  {
    text: "How to learn machine learning in 3 months",
    category: 'planning',
    icon: '📋'
  },
  
  // Image generation examples
  {
    text: "Generate an image of a serene mountain landscape at sunset",
    category: 'images',
    icon: '🎨'
  },
  {
    text: "Create a picture of a cute robot playing with colorful blocks",
    category: 'images',
    icon: '🎨'
  },
  
  // Website editing examples
  {
    text: "Initialize sample HTML files and create a simple portfolio website with navigation, about section, and contact form",
    category: 'website',
    icon: '🌐'
  },
  {
    text: "Create a modern landing page with dark theme, hero section, and animated CSS buttons",
    category: 'website',
    icon: '🌐'
  }
]

const categoryLabels: Record<ToolCategory, string> = {
  all: 'All Examples',
  calculator: 'Calculator',
  weather: 'Weather',
  planning: 'Task Planning', 
  images: 'Image Generation',
  website: 'Website Editing'
}

export function ExamplePrompts({ 
  onPromptClick, 
  disabled = false,
  className 
}: ExamplePromptsProps) {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory>('all')

  const filteredExamples = selectedCategory === 'all' 
    ? examples 
    : examples.filter(example => example.category === selectedCategory)

  return (
    <div className={cn("space-y-3", className)}>
      {/* Category Filter */}
      <div className="flex items-center gap-3">
        <div className="text-xs text-muted-foreground">Try these agentic examples:</div>
        <Select
          value={selectedCategory}
          onValueChange={(value: ToolCategory) => setSelectedCategory(value)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                <span className="text-xs">{label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Example Buttons */}
      <div className="flex flex-wrap gap-2">
        {filteredExamples.map((example, index) => (
          <Button
            key={`${example.category}-${index}`}
            variant="ghost"
            size="sm"
            onClick={() => onPromptClick(example.text)}
            disabled={disabled}
            className="h-auto py-1 px-2 text-xs text-left justify-start"
          >
            <Badge variant="outline" className="mr-2 h-4 text-[10px] flex-shrink-0">
              {example.icon}
            </Badge>
            <span className="break-words">{example.text}</span>
          </Button>
        ))}
      </div>
      
      {filteredExamples.length === 0 && (
        <div className="text-xs text-muted-foreground italic">
          No examples available for this category.
        </div>
      )}
    </div>
  )
}