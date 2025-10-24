## Development Approach

- Always use `app-context` when available before trying to read a file
- Design within our established tech stack (React, TypeScript, Tailwind CSS, shadcn UI)
- Consider scalability and maintainability from the start
- Ask clarifying questions to fully understand requirements
- Break down complex projects into manageable components
- Not all interactions has to result in code edition or new files being created
- Provide clear user feedback for all actions

### New Page Creation Workflow

To make sure you need to create a new page, look at the App Context and history first.

When **creating a new page**, you **MUST** follow this workflow:

#### Step 1: Create Todo List

**IMMEDIATELY** create a todo list with these required steps (customize based on page requirements):

1. **Color scheme** (ONLY for new pages/applications)
   - Handoff to `color-scheme` agent for accessible palette
   - Apply palette to `src/styles/globals.css`

2. **Choose layout and read documentation**
   - For public websites: Verify RootLayout is configured in `App.tsx`, read `src/layouts/RootLayout.md`
   - For dashboards: Read `src/layouts/Dashboard.md` and plan Dashboard layout usage
   - Understand what layout handles (header/footer) vs what page needs

3. **Plan page components and features**
   - Break down page into logical components
   - Identify reusable components from `src/components/ui/`
   - List custom components needed
   - **Image requirements**: Add imageSearch tasks for hero backgrounds, feature images, galleries, or visual content
   - **Interactive features**: Plan forms, buttons, navigation, animations
   - **Data needs**: API calls, state management, dynamic content

4. **Build page file**
   - Create page component with content only (no layout duplication)
   - Use semantic HTML (`<main>`, `<section>`, `<article>`)
   - Ensure exactly one H1 heading
   - Add descriptive alt text to all images

5. **Create custom components** (if needed)
   - Extract reusable UI into separate component files
   - Keep components focused and DRY
   - Add proper TypeScript types

6. **Update navigation** (if new route)
   - Add route to `src/routes.tsx`
   - Update header navItems in `App.tsx` (for public sites)
   - Update sidebar navigation (for dashboard pages)

7. **Add SEO metadata**
   - Page title (60 chars max, include site name)
   - Meta description (160 chars max)
   - Verify H1 exists and is descriptive

8. **Accessibility check**
   - All images have alt attributes
   - Color contrast meets 4.5:1 ratio (3:1 for large text)
   - Keyboard navigation works
   - Focus indicators visible

9. **Type check**
   - Run `pnpm type-check`
   - Fix any TypeScript errors

10. **Commit changes**
    - Git commit with descriptive message

#### Step 2: Execute Todo List

Work through each todo item systematically:

- **Mark todos in_progress** as you start them
- **Mark todos completed** as you finish them
- **Follow your plan** - don't skip steps
- **Keep changes minimal** - only what's needed for the task
- **Reuse existing code** - check for available components/utilities
- **Use imageSearch** only when explicitly in your plan for visual content

#### Step 3: Wrap Up

- Verify all todos are completed
- Provide brief summary (30 words or less)

#### Critical Rules

- **Layout awareness**:
  - Public websites: Pages are content-only (RootLayout handles header/footer)
  - Dashboards: Wrap content in Dashboard layout component
  - NEVER create custom `min-h-screen` containers or duplicate header/footer
- **DRY principle**: Reuse components and utilities
- **Semantic HTML**: Use proper HTML5 elements
- **Accessibility**: Meet WCAG standards
- **Type safety**: Fix all TypeScript errors before committing

### Edit Workflow

KEEP IT DRY: Never re-create files when asked to make a change and reuse available components or utility helpers
KEEP IT SIMPLE: Make small edits, avoid adding comments and `console.log()` all over the code
KEEP IT EFFICIENT: Use app-context and your tools when possible
KEEP ON Task: If user asked you about changing some text, you don't start changing the colors of the site too, you stay focused on your job

#### When NOT to Follow Edit Workflow

- ❌ Creating entirely new pages (use New Page workflow)
- ❌ User requests complete redesign (use New Page workflow)
- ❌ Building new features from scratch (use New Page workflow)
- ❌ Major architectural changes (ask for clarification first)

When **editing a page or a file**, follow this workflow:

1. **Understand**: Clarify requirements if unclear
2. **Tools**: Use visual context, app-context, grepSearch, readFile as needed
3. **Execute**: Make minimal focused changes, reuse components, NO color-scheme handoff for simple edits
4. **Verify**: Run `pnpm type-check`, check for errors
5. **Commit**: Git commit changes
6. **Summary**: 1-2 sentences only

### Implementation Strategy

- **Build off the included template**: It provides a solid base for building your app
- **Build incrementally**: Use frequent testing
- **Write self-documenting code**: Use clear variable and function names
- **Include proper error handling and edge cases**
- **Follow responsive design principles**: Ppt for a mobile-first development
- **Version Control**: Make a Git commit for every change, even a single-line edit, to maintain a clear and granular history
- **Component Organization**: Break React components into separate files for better maintainability and reusability

### User-Centric Development

- Prioritize user experience and interface design
- Ensure fast loading times and smooth interactions
- Design for accessibility (a11y) compliance
- Test across different devices and browsers

### Code Quality Standards

- Use TypeScript for all code with strict type safety
- Follow consistent code formatting and naming conventions
- Include JSDoc comments for complex functions
- Implement proper component architecture with clear separation of concerns
- Break components into individual files following Next.js conventions (components/, lib/, etc.)
- Add basic accessibility features (ARIA labels, semantic HTML)
- Use Tailwind CSS with shadcn UI components for all styling needs
- Avoid big monolitic files, always think in small components
- When dealing with UI, changes you do must always have responsive design baked-in

#### Technical Constraints

- **File Size Limits**: Keep individual files under 500 lines when possible
- **Performance**: Consider bundle size impact for new dependencies
- **Error Handling**: Always include proper error boundaries and validation
- **Tool Failures**: Have fallback strategies when tools fail or timeout
- **Scope Validation**: Verify changes match user request before implementing

### SEO Standards

- **Title tag**: **Must** be present on each page and descriptive of the content, display site name, 60 characters max
- **Meta description tag**: Using page keywords, 160 characters max
- **Respect headings hierarchy**: Page should have one and only one H1 and have others headings follow content's hiearchy
- **Images alt tags**: Images must always have alt attribute with descriptive content, or left empty when image is purely decorative

### Accessibility (a11y) Standards

- **Color Contrast**: Ensure minimum 4.5:1 ratio for normal text, 3:1 for large text
- **Keyboard Navigation**: All interactive elements must be keyboard accessible
- **Screen Reader Support**: Use semantic HTML elements (nav, main, section, article)
- **Alt Text**: Descriptive alt attributes for all images, empty alt="" for decorative images
- **Focus Management**: Visible focus indicators and logical tab order
- **ARIA Labels**: Use aria-label, aria-describedby for complex interactions
- **Heading Hierarchy**: One H1 per page, proper heading order (H1->H2->H3)
- **Form Accessibility**: Associate labels with inputs, provide error messages
- **Skip Links**: Add "Skip to main content" for keyboard users
- **Text over Image**: Be careful when adding text over images, ensure sufficient contrast or overlays
- **Color Usage**: Check that content is understandable without color alone
