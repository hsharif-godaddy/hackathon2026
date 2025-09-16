import { BaseAgent } from '../base/index.js';
import type { AgentConfig, AgentExecutionContext } from '../base/index.js';

/**
 * Color Scheme Agent - Interactive color palette designer
 * Helps users discover and create perfect color schemes for their applications
 */
export class ColorSchemeAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'color-scheme',
      name: 'Color Scheme Designer',
      description: 'Interactive color palette designer that helps users create beautiful, accessible color schemes through guided discovery and visual selection',
      model: 'claude-sonnet-4-20250514',
      tools: [
        { 
          name: 'app_plan', 
          description: 'Store and manage app planning data including color palettes, app names, and flexible project data'
        },
        { 
          name: 'file_edit', 
          description: 'Create and edit files for color scheme documentation, CSS files, and design tokens'
        },
        { 
          name: 'read_file', 
          description: 'Read existing design files, color schemes, and project documentation'
        },
        { 
          name: 'directory_listing', 
          description: 'Explore project structure to understand where to save color schemes and design files'
        },
        {
          name: 'image_generate',
          description: 'Generate visual color palette previews and UI mockups to show color schemes in context'
        }
      ],
      contextBuilder: {
        tools: ['color_designer', 'app_planner'],
        skipContextBuilding: false,
      },
      handoffs: [
        {
          agentName: 'develop',
          description: 'Hand off to development agent to implement the chosen color scheme in the application',
        },
      ],
      version: '1.0.0',
      tags: ['design', 'color', 'ui', 'branding', 'accessibility'],
    };

    super(config);
  }

  /**
   * Customize the system prompt with color-specific instructions
   */
  protected customizeSystemPrompt(
    basePrompt: string,
    context?: AgentExecutionContext
  ): string {
    let customizedPrompt = basePrompt;

    const colorSpecificInstructions = `

## Color Design Guidelines

### Interactive Flow Management
- Always start with project discovery questions
- Use the app_plan tool to store user responses and progress
- Present visual elements and choices throughout the process
- Build upon previous responses to create personalized experiences

### Color Psychology Application
- Consider the emotional impact of color choices
- Match colors to brand personality and target audience
- Explain the reasoning behind color recommendations
- Factor in cultural and accessibility considerations

### Technical Implementation
- Store all color data using the app_plan tool
- Provide colors in multiple formats (hex, RGB, HSL)
- Include usage guidelines and implementation notes
- Ensure all palettes meet WCAG AA standards

### Visual Presentation
When presenting color options:
- Describe colors with vivid, relatable names
- Show colors in realistic UI contexts
- Explain how colors work together
- Highlight accessibility features

### Sample Color Palette Names
- "Ocean Breeze" (blues and teals)
- "Sunset Glow" (oranges and warm tones)
- "Forest Path" (greens and earth tones)
- "Midnight Sky" (dark blues and purples)
- "Fresh Morning" (light blues and whites)

Remember: You're not just selecting colors, you're crafting a visual identity that enhances user experience and supports the application's goals.
`;

    return customizedPrompt + colorSpecificInstructions;
  }

  /**
   * Validate that the color scheme agent is properly configured
   */
  async validate(): Promise<void> {
    await super.validate();
    
    // Ensure required tools are available
    const requiredTools = ['app_plan', 'file_edit'];
    const availableTools = this.getTools().map(tool => tool.name);
    
    for (const tool of requiredTools) {
      if (!availableTools.includes(tool)) {
        throw new Error(`Color Scheme Agent requires ${tool} tool but it's not available`);
      }
    }
  }

  /**
   * Initialize color scheme templates and defaults
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Could initialize default color schemes, templates, etc.
    console.log('🎨 Color Scheme Agent initialized - ready to design beautiful palettes!');
  }

  /**
   * Custom processing for color-related tool calls
   */
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    // Add context or validation for color-specific operations
    if (toolName === 'app_plan' && typeof args === 'object' && args !== null) {
      const planArgs = args as any;
      
      // Ensure we're working with color palette data correctly
      if (planArgs.colorPalette) {
        console.log('🎨 Processing color palette data:', planArgs.colorPalette);
      }
    }
    
    return args;
  }

  /**
   * Process tool results for color-specific enhancements
   */
  async afterToolExecution(toolName: string, args: unknown, result: unknown): Promise<unknown> {
    if (toolName === 'app_plan') {
      // Could add color palette validation or enhancement here
      console.log('✅ App plan operation completed for color scheme');
    }
    
    return result;
  }
}
