# Airo App Builder Template

A modern, production-ready Next.js template with TypeScript, Tailwind CSS, and comprehensive tooling setup.

## 🚀 What's Included

### Core Framework
- **[Next.js 15.1.0](https://nextjs.org/)** - React framework with App Router
- **[React 19](https://react.dev/)** - Latest React with concurrent features
- **[TypeScript 5](https://www.typescriptlang.org/)** - Type safety and developer experience

### Styling & UI
- **[Tailwind CSS 3.4](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Lucide React](https://lucide.dev/)** - Beautiful, customizable SVG icons
- **Custom Animations** - Pre-configured smooth animations and transitions
  - Geometric loader component with floating, rotating, and pulsing effects
  - Extended Tailwind animations: `spin-slow`, `pulse-slow`, `bounce-gentle`, `float`, `rotate-clockwise`, `rotate-counter`

### Development Tools
- **[ESLint 9](https://eslint.org/)** - Code linting with comprehensive rules
  - Modern flat config format
  - Next.js and TypeScript optimized rules
  - Import organization and sorting
  - Consistent code style enforcement
- **[PostCSS](https://postcss.org/)** - CSS processing with Autoprefixer
- **TypeScript Configuration** - Optimized for Next.js development

### Project Structure
```
src/
├── app/                 # Next.js App Router
│   ├── components/      # Reusable React components
│   ├── globals.css      # Global styles with Tailwind
│   ├── layout.tsx       # Root layout component
│   └── page.tsx         # Home page
├── ...
```
## 🛠️ Available Scripts

```bash
# Build for production
npm run build

# Run linting
npm run lint
```

## 📦 Key Dependencies

### Runtime Dependencies
- `next@15.1.0` - React framework
- `react@^19.0.0` - UI library
- `react-dom@^19.0.0` - React DOM bindings
- `lucide-react@^0.460.0` - Icon library

### Development Dependencies
- `typescript@^5` - Type checking
- `eslint@^9` - Code linting
- `tailwindcss@^3.4.16` - CSS framework
- `@eslint/eslintrc@^3.2.0` - ESLint flat config support
- `eslint-plugin-import@^2.31.0` - Import/export linting

## 🎯 ESLint Configuration

The template includes a comprehensive ESLint setup with:
- **React/JSX rules** - Proper component patterns
- **TypeScript rules** - Type safety enforcement
- **Import organization** - Automatic sorting and grouping
- **Code style** - Consistent formatting
- **Next.js optimizations** - Framework-specific best practices

## 🎨 Tailwind Extensions

Custom animations and utilities:
- **Animations**: `float`, `rotate-clockwise`, `rotate-counter`, `spin-slow`, `pulse-slow`, `bounce-gentle`
- **Global Reset** - Consistent box-sizing and spacing
- **Responsive Design** - Mobile-first approach

## 🏗️ Built with Airo App Builder

This template was created and optimized by [Airo App Builder](https://airo.ai/) for rapid, production-ready application development.
