import { readFile } from 'fs/promises'
import { resolve } from 'path'

/**
 * Context object passed to condition functions and dynamic text functions
 */
export interface PromptContext {
  /** User data or application state */
  user?: Record<string, any>
  /** Application configuration */
  config?: Record<string, any>
  /** Environment variables */
  env?: Record<string, any>
  /** Custom context data */
  [key: string]: any
}

/**
 * Condition function that determines if a section should be included
 */
export type ConditionFunction = (context: PromptContext) => boolean | Promise<boolean>

/**
 * Dynamic text function that generates content based on context
 */
export type DynamicTextFunction = (context: PromptContext) => string | Promise<string>

/**
 * Base interface for all prompt sections
 */
export interface PromptSection {
  /** Section type identifier */
  type: string
  /** Optional condition to determine if section should be included */
  condition?: ConditionFunction
  /** Build the section content */
  build(context: PromptContext): Promise<string>
}

/**
 * Text section - static or dynamic text content
 */
export class TextSection implements PromptSection {
  type = 'text'
  condition?: ConditionFunction
  
  constructor(
    private content: string | DynamicTextFunction,
    condition?: ConditionFunction
  ) {
    if (condition) {
      this.condition = condition
    }
  }

  async build(context: PromptContext): Promise<string> {
    if (typeof this.content === 'function') {
      return await this.content(context)
    }
    return this.content
  }
}

/**
 * File section - content loaded from a file
 */
export class FileSection implements PromptSection {
  type = 'file'
  condition?: ConditionFunction
  
  constructor(
    private filePath: string,
    condition?: ConditionFunction
  ) {
    if (condition) {
      this.condition = condition
    }
  }

  async build(_context: PromptContext): Promise<string> {
    try {
      const resolvedPath = resolve(this.filePath)
      const content = await readFile(resolvedPath, 'utf-8')
      return content.trim()
    } catch (error) {
      throw new Error(`Failed to read file ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * Conditional section - wraps other sections with a condition
 */
export class ConditionalSection implements PromptSection {
  type = 'conditional'
  condition?: ConditionFunction
  
  constructor(
    private sections: PromptSection[],
    condition: ConditionFunction
  ) {
    this.condition = condition
  }

  async build(context: PromptContext): Promise<string> {
    const results: string[] = []
    
    for (const section of this.sections) {
      // Check section's own condition first
      if (section.condition && !(await section.condition(context))) {
        continue
      }
      
      const content = await section.build(context)
      if (content.trim()) {
        results.push(content)
      }
    }
    
    return results.join('\n\n')
  }
}

/**
 * Template section - supports variable interpolation
 */
export class TemplateSection implements PromptSection {
  type = 'template'
  condition?: ConditionFunction
  
  constructor(
    private template: string,
    condition?: ConditionFunction
  ) {
    if (condition) {
      this.condition = condition
    }
  }

  async build(context: PromptContext): Promise<string> {
    // Simple template interpolation - replace {{key}} with context values
    return this.template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const value = this.getNestedValue(context, key.trim())
      return value !== undefined ? String(value) : match
    })
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }
}

/**
 * Dynamic list function that generates an array based on context
 */
export type DynamicListFunction = (context: PromptContext) => string[] | Promise<string[]>

/**
 * List section - formats arrays as lists
 */
export class ListSection implements PromptSection {
  type = 'list'
  condition?: ConditionFunction
  
  constructor(
    private items: Array<string | DynamicTextFunction> | DynamicListFunction,
    private format: 'bullet' | 'numbered' | 'dash' = 'bullet',
    condition?: ConditionFunction
  ) {
    if (condition) {
      this.condition = condition
    }
  }

  async build(context: PromptContext): Promise<string> {
    let itemsArray: Array<string | DynamicTextFunction>
    
    // Check if items is a function that returns an array
    if (typeof this.items === 'function') {
      const result = await this.items(context)
      itemsArray = Array.isArray(result) ? result : []
    } else {
      itemsArray = this.items
    }
    
    const resolvedItems: string[] = []
    
    for (const item of itemsArray) {
      if (typeof item === 'function') {
        resolvedItems.push(await item(context))
      } else {
        resolvedItems.push(item)
      }
    }

    const filteredItems = resolvedItems.filter(item => item.trim())
    
    if (filteredItems.length === 0) {
      return ''
    }

    switch (this.format) {
      case 'numbered':
        return filteredItems.map((item, index) => `${index + 1}. ${item}`).join('\n')
      case 'dash':
        return filteredItems.map(item => `- ${item}`).join('\n')
      case 'bullet':
      default:
        return filteredItems.map(item => `• ${item}`).join('\n')
    }
  }
}

/**
 * Main PromptBuilder class with fluent API
 */
export class PromptBuilder {
  private sectionList: PromptSection[] = []

  /**
   * Add a text section (static or dynamic)
   */
  text(content: string | DynamicTextFunction): PromptBuilder {
    this.sectionList.push(new TextSection(content))
    return this
  }

  /**
   * Add a file section
   */
  file(filePath: string): PromptBuilder {
    this.sectionList.push(new FileSection(filePath))
    return this
  }

  /**
   * Add a template section with variable interpolation
   */
  template(template: string): PromptBuilder {
    this.sectionList.push(new TemplateSection(template))
    return this
  }

  /**
   * Add a list section
   */
  list(items: Array<string | DynamicTextFunction> | DynamicListFunction, format: 'bullet' | 'numbered' | 'dash' = 'bullet'): PromptBuilder {
    this.sectionList.push(new ListSection(items, format))
    return this
  }

  /**
   * Add a conditional section
   */
  when(condition: ConditionFunction): ConditionalBuilder {
    return new ConditionalBuilder(this, condition)
  }

  /**
   * Add any custom section
   */
  section(section: PromptSection): PromptBuilder {
    this.sectionList.push(section)
    return this
  }

  /**
   * Add multiple sections
   */
  sections(...sections: PromptSection[]): PromptBuilder {
    this.sectionList.push(...sections)
    return this
  }

  /**
   * Build the final prompt string
   */
  async build(context: PromptContext = {}): Promise<string> {
    const results: string[] = []
    
    for (const section of this.sectionList) {
      // Check if section has a condition
      if (section.condition && !(await section.condition(context))) {
        continue
      }
      
      try {
        const content = await section.build(context)
        if (content.trim()) {
          results.push(content.trim())
        }
      } catch (error) {
        throw new Error(`Failed to build section (${section.type}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    
    return results.join('\n\n')
  }

  /**
   * Get a copy of all sections
   */
  getSections(): PromptSection[] {
    return [...this.sectionList]
  }

  /**
   * Clear all sections
   */
  clear(): PromptBuilder {
    this.sectionList = []
    return this
  }
}

/**
 * Conditional builder for fluent API
 */
export class ConditionalBuilder {
  private sections: PromptSection[] = []

  constructor(
    private parent: PromptBuilder,
    private condition: ConditionFunction
  ) {}

  /**
   * Add text to the conditional section
   */
  text(content: string | DynamicTextFunction): ConditionalBuilder {
    this.sections.push(new TextSection(content))
    return this
  }

  /**
   * Add file to the conditional section
   */
  file(filePath: string): ConditionalBuilder {
    this.sections.push(new FileSection(filePath))
    return this
  }

  /**
   * Add template to the conditional section
   */
  template(template: string): ConditionalBuilder {
    this.sections.push(new TemplateSection(template))
    return this
  }

  /**
   * Add list to the conditional section
   */
  list(items: Array<string | DynamicTextFunction> | DynamicListFunction, format: 'bullet' | 'numbered' | 'dash' = 'bullet'): ConditionalBuilder {
    this.sections.push(new ListSection(items, format))
    return this
  }

  /**
   * End the conditional section and return to main builder
   */
  end(): PromptBuilder {
    const conditionalSection = new ConditionalSection(this.sections, this.condition)
    return this.parent.section(conditionalSection)
  }
}

/**
 * Helper functions for creating common conditions
 */
export const conditions = {
  /**
   * Check if a value exists in context
   */
  exists: (path: string): ConditionFunction => {
    return (context) => {
      const value = path.split('.').reduce((current, key) => current?.[key], context)
      return value !== undefined && value !== null
    }
  },

  /**
   * Check if a value equals something
   */
  equals: (path: string, value: any): ConditionFunction => {
    return (context) => {
      const contextValue = path.split('.').reduce((current, key) => current?.[key], context)
      return contextValue === value
    }
  },

  /**
   * Check if environment variable is set
   */
  env: (name: string, value?: string): ConditionFunction => {
    return () => {
      const envValue = process.env[name]
      if (value !== undefined) {
        return envValue === value
      }
      return envValue !== undefined
    }
  },

  /**
   * Check if a file exists
   */
  fileExists: (filePath: string): ConditionFunction => {
    return async () => {
      try {
        const { existsSync } = await import('fs')
        return existsSync(filePath)
      } catch (error) {
        return false
      }
    }
  },

  /**
   * Combine conditions with AND
   */
  and: (...conditions: ConditionFunction[]): ConditionFunction => {
    return async (context) => {
      for (const condition of conditions) {
        if (!(await condition(context))) {
          return false
        }
      }
      return true
    }
  },

  /**
   * Combine conditions with OR
   */
  or: (...conditions: ConditionFunction[]): ConditionFunction => {
    return async (context) => {
      for (const condition of conditions) {
        if (await condition(context)) {
          return true
        }
      }
      return false
    }
  },

  /**
   * Negate a condition
   */
  not: (condition: ConditionFunction): ConditionFunction => {
    return async (context) => !(await condition(context))
  }
}

/**
 * Factory function to create a new prompt builder
 */
export function createPromptBuilder(): PromptBuilder {
  return new PromptBuilder()
}

/**
 * Convenience helper functions
 */
export const pb = {
  /**
   * Create a text section
   */
  text: (content: string | DynamicTextFunction) => new TextSection(content),

  /**
   * Create a file section
   */
  file: (filePath: string) => new FileSection(filePath),

  /**
   * Create a template section
   */
  template: (template: string) => new TemplateSection(template),

  /**
   * Create a list section
   */
  list: (items: Array<string | DynamicTextFunction> | DynamicListFunction, format: 'bullet' | 'numbered' | 'dash' = 'bullet') => 
    new ListSection(items, format),

  /**
   * Create a conditional wrapper
   */
  when: (condition: ConditionFunction, ...sections: PromptSection[]) => 
    new ConditionalSection(sections, condition),

  /**
   * Create a conditional section with content
   */
  section: (content: PromptSection, condition?: ConditionFunction) => {
    if (condition) {
      content.condition = condition
    }
    return content
  }
}

/**
 * Alias for conditions (for more natural syntax)
 */
export const when = conditions
