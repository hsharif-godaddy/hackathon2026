# Development Approach

## New Page creation Workflow

1. Make sure you are creating a new page, by look at the App Context, and history to decide this
2. Pick a color palette first
    - always begin by initiating a handoff to the `color-scheme` agent to return one finalized, accessible palette as strict JSON (v8 semantic variables).
    - Immediately apply the returned palette by updating `src/styles/globals.css` variables for both `:root` and `.dark` using the `fileEdit` tool
3. Pick a layout by following the Layouts Usage Guidelines
4. Use imageSearch if any images are required
    - This step is optional, but you can't hotlink in images from other sites
5. Build out the new page
6. Verify the page is working correctly by running `pnpm type-check` and viewing the logs
    - When viewing logs focus on errors, you can ignore HMR loglines
7. Commit your changes
8. Give a short summary (50 works or less) of the changes

## Edit Workflow

Never re-created files when asked to make a change. Make small edits.

1. Identify the code to change
    - Use visual context and ai edit context if available
    - use app-context
    - use the grepSearch tool
    - use the readFile tool if many edits are needed in a file
2. Use the fileEdit tool in edit mode to make your changes
3. Verify the page is working correctly by running `pnpm type-check` and viewing the logs
    - When viewing logs focus on errors, you can ignore HMR loglines
4. Commit your changes
5. Give a short summary (30 words or less) of the changes

## Understanding & Planning

- Ask clarifying questions to fully understand requirements
- Break down complex projects into manageable components
- Design within our established tech stack (React, TypeScript, Tailwind CSS, shadcn UI)
- Consider scalability and maintainability from the start

## Implementation Strategy

- Build off the included template, it provides a solid base for building your app
- Build incrementally with frequent testing
- Write self-documenting code with clear variable and function names
- Include proper error handling and edge cases
- Follow responsive design principles for mobile-first development
- **Version Control**: Make a Git commit for every change, even a single-line edit, to maintain a clear and granular history
- **Component Organization**: Break React components into separate files for better maintainability and reusability

## Code Quality Standards

- Use TypeScript for all code with strict type safety
- Follow consistent code formatting and naming conventions
- Include JSDoc comments for complex functions
- Implement proper component architecture with clear separation of concerns
- Break components into individual files following Next.js conventions (components/, lib/, etc.)
- Add basic accessibility features (ARIA labels, semantic HTML)
- Use Tailwind CSS with shadcn UI components for all styling needs

## User-Centric Development

- Prioritize user experience and interface design
- Ensure fast loading times and smooth interactions
- Design for accessibility (a11y) compliance
- Test across different devices and browsers
- Provide clear user feedback for all actions
