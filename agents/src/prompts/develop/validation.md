## Validation Framework

### Pre-Implementation Validation

#### Requirement Analysis Checklist

- ✅ User request is clear and specific
- ✅ Scope is appropriate for requested change type
- ✅ Required tools and context are available
- ✅ No conflicting instructions or ambiguities
- ✅ Technical feasibility within constraints

#### Tool Selection Validation

- ✅ Chosen tools match the task scope
- ✅ No unnecessary tool usage (color-scheme for text edits, mediaSearch for forms)
- ✅ Context hierarchy properly applied (AI Edit Context > Visual Context > General)
- ✅ Decision matrix guidelines followed

### Implementation Quality Gates

#### Code Quality Checkpoints

1. **TypeScript Compliance**: All code must pass strict type checking
2. **Component Architecture**: Proper separation of concerns and reusable components
3. **Performance Impact**: Consider bundle size and runtime performance
4. **Accessibility Standards**: Meet WCAG 2.1 AA requirements
5. **Responsive Design**: Mobile-first approach with proper breakpoints

#### Error Handling Requirements

- **Input Validation**: Validate all user inputs and API responses
- **Error Boundaries**: Implement React error boundaries for UI components
- **Graceful Degradation**: Provide fallbacks when features fail
- **User Feedback**: Clear error messages and loading states
- **Tool Failure Recovery**: Handle tool timeouts and failures appropriately

### Post-Implementation Verification

#### Technical Validation

- ✅ Run `npm run type-check` - zero TypeScript errors
- ✅ Code builds successfully without warnings
- ✅ No console errors in browser
- ✅ All interactive elements keyboard accessible
- ✅ Responsive design works on mobile/tablet/desktop

#### Functional Validation

- ✅ User requirements fully met
- ✅ No unintended side effects or changes
- ✅ Existing functionality still works
- ✅ New code follows established patterns
- ✅ Changes are minimal and focused

#### Performance Validation

- ✅ Page load times remain acceptable
- ✅ No memory leaks or excessive re-renders
- ✅ Images optimized and properly sized
- ✅ Bundle size impact is minimal

### Success Criteria

#### Completion Requirements

A task is only complete when ALL of the following are true:

- ✅ All functional requirements implemented
- ✅ TypeScript compilation passes
- ✅ Accessibility standards met
- ✅ Responsive design verified
- ✅ No regressions introduced
- ✅ Code follows project conventions
- ✅ Changes committed with clear message

#### Failure Conditions

Stop and reassess if ANY of the following occur:

- ❌ TypeScript errors cannot be resolved
- ❌ Changes break existing functionality
- ❌ Accessibility violations introduced
- ❌ Performance significantly degraded
- ❌ Requirements unclear or conflicting
- ❌ Tool failures prevent completion

### Escalation Guidelines

#### When to Ask for Clarification

- Requirements are ambiguous or conflicting
- Multiple interpretation paths exist
- Changes would affect areas not mentioned
- Technical constraints prevent full implementation
- User context suggests different approach needed

#### When to Stop and Report Issues

- Critical errors that cannot be resolved
- Missing dependencies or tools
- Scope creep beyond original request
- Security or accessibility concerns
- Performance issues that cannot be mitigated
