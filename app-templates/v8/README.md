# V8 App Template

A modern, production-ready web application template built with Vite, React, and TypeScript. Designed for AI-assisted development with component introspection, layout systems, and excellent developer experience.

## 🚀 Features

- **⚡ Lightning Fast**: Vite for instant hot module replacement and optimized builds
- **🎯 Type Safe**: Full TypeScript coverage across frontend and backend
- **🎨 Beautiful UI**: shadcn/ui components with Tailwind CSS
- **🧠 AI-Friendly**: Component introspection for AI development tools
- **📱 Responsive**: Mobile-first design with modern CSS
- **🔧 Developer Experience**: Hot reload, linting, formatting, and testing setup
- **🚀 Production Ready**: SSR support, optimized builds, and deployment-ready

## 🛠️ Tech Stack

### Frontend
- **React 18+** - Modern React with hooks and concurrent features
- **TypeScript 5** - Full type safety across the application
- **Vite 5** - Fast build tool and dev server with HMR
- **Tailwind CSS 3** - Utility-first CSS framework
- **shadcn/ui** - Beautiful, accessible component library
- **React Router DOM** - Client-side routing
- **Framer Motion** - Smooth animations and transitions

### Backend
- **Node.js API** - Simple health check and utilities
- **TypeScript** - Type-safe backend development

### Development Tools
- **ESLint 9** - Code linting
- **Prettier** - Code formatting
- **Vitest** - Fast unit testing
- **TypeScript ESLint** - TypeScript-specific linting

> **Note:** SSR support with vite-plugin-ssr has been temporarily removed due to compatibility issues with the directory structure. This can be re-added later when the plugin is updated or replaced with a more stable alternative.

## 📁 Project Structure

```
v8-app-template/
├── src/
│   ├── components/        # React components
│   │   ├── ui/           # shadcn/ui base components (40+ components)
│   │   └── GeometricSpinner.tsx
│   ├── layouts/          # Layout systems
│   │   ├── Website.tsx   # Main website layout
│   │   ├── Dashboard.tsx # Dashboard layout
│   │   ├── Website.md    # Layout documentation
│   │   └── parts/        # Layout components
│   │       ├── Header.tsx
│   │       └── Footer.tsx
│   ├── pages/            # Page components
│   │   ├── index.tsx     # Homepage
│   │   └── _404.tsx      # 404 page
│   ├── lib/              # Utilities and API
│   │   ├── utils.ts      # Utility functions
│   │   └── api-client.ts # API client
│   ├── api/              # Backend API routes
│   │   └── health.ts     # Health check endpoint
│   ├── styles/           # Global styles
│   │   └── globals.css
│   ├── test/             # Test setup
│   │   └── setup.ts
│   ├── App.tsx           # Root application component
│   ├── main.tsx          # Application entry point
│   ├── router.ts         # Route definitions
│   └── routes.tsx        # Route components
├── dev-tools/            # Development mode enhancements
├── source-mapper/        # AI introspection plugin
├── public/               # Static assets
└── scripts/              # Development scripts
```

## 📜 Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run test` - Run Vitest unit tests
- `npm run lint` - Run ESLint code linting
- `npm run type-check` - Run TypeScript type checking
- `npm run setup` - Initialize project with dependencies

## 🎨 UI Components

This template includes shadcn/ui components that are:
- **Accessible** - Built with Radix UI primitives
- **Customizable** - Easy to modify and extend
- **Consistent** - Design system with CSS variables
- **Copy-paste friendly** - Own your components

The template includes 40+ pre-configured shadcn/ui components:
- **Layout**: Card, Separator, Tabs, Sheet, Dialog
- **Forms**: Button, Input, Textarea, Select, Checkbox, Switch
- **Navigation**: Navigation Menu, Breadcrumb, Pagination
- **Feedback**: Alert, Badge, Progress, Skeleton, Sonner
- **Data Display**: Table, Avatar, Calendar, Hover Card
- **Overlays**: Popover, Tooltip, Alert Dialog, Drawer
- **Interactive**: Accordion, Collapsible, Command, Context Menu

To add new components:
```bash
npx shadcn-ui@latest add component-name
```

## 🧠 AI Integration

### Component Introspection

The custom source-mapper plugin adds metadata to components in development:

```html
<div data-source-file="/src/components/Button.tsx" 
     data-source-line="15" 
     data-source-component="Button">
  Click Me
</div>
```

### Development Mode Integration

The dev-tools package provides:
- **Element selection**: Click to identify components
- **Live editing**: Modify component props in real-time
- **Source mapping**: Navigate directly to component source
- **AI integration**: Enhanced context for AI development tools

### AI-Friendly Patterns

- **Consistent naming**: PascalCase components, camelCase hooks
- **Clear file structure**: Logical separation of concerns
- **Type-first approach**: Comprehensive TypeScript types
- **Standard patterns**: CRUD operations, form handling, error boundaries

## 🗃️ API & Layouts

### API Routes
The template includes:
- `GET /api/health` - Health check endpoint
- Extensible API client setup in `src/lib/api-client.ts`

### Layout System
Two pre-built layout options:

**Website Layout** (`src/layouts/Website.tsx`):
- Configurable header with navigation and actions
- Optional footer with multiple variants
- Responsive design with mobile menu
- Perfect for marketing sites and applications

**Dashboard Layout** (`src/layouts/Dashboard.tsx`):
- Sidebar navigation
- Header with user actions
- Content area with proper spacing
- Ideal for admin panels and dashboards

See `src/layouts/*.md` for detailed usage documentation.

## 🧪 Testing

Run tests with:
```bash
npm run test
```

The template includes:
- **Vitest** - Fast unit testing framework
- **React Testing Library** - Component testing utilities
- **Jest DOM** - Custom Jest matchers

## 📦 Deployment

### Build for production:
```bash
npm run build
```

### Deploy options:
- **Vercel/Netlify** - Frontend deployment
- **Railway/Render** - Full-stack deployment
- **Docker** - Containerized deployment

## 🔧 Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```env
VITE_APP_NAME=V8 App Template
VITE_API_URL=http://localhost:5173/api
NODE_ENV=development
PORT=5173
```

### Custom Plugins

**Source Mapper Plugin**: Adds component introspection for AI tools
**Dev Tools Plugin**: Enables development mode enhancements
**Fullstory Integration**: Optional user analytics (configurable)

Configure in `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import { sourceMapperPlugin } from './source-mapper'
import { devToolsPlugin } from './dev-tools'

export default defineConfig({
  plugins: [
    sourceMapperPlugin(),
    devToolsPlugin(),
  ]
})
```

## 🎯 Best Practices

### Component Architecture
- Keep components small and focused
- Use composition over inheritance
- Extract reusable logic into hooks
- Prefer function components with hooks

### State Management
- Keep local state in components with useState/useReducer
- Use React Context for app-wide state (theme, auth)
- Consider external libraries (Zustand, Redux Toolkit) for complex state
- Leverage layout props for shared configuration

### Layout Usage
- Always use Website or Dashboard layout as page wrapper
- Configure layouts via props, not custom implementations
- Follow layout documentation in `src/layouts/*.md`
- Use consistent navigation and header patterns

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if needed
5. Run linting and tests
6. Submit a pull request

## 📄 License

MIT License - feel free to use this template for any project.

## 🙏 Acknowledgments

Built with amazing open-source tools:
- [Vite](https://vitejs.dev/)
- [React](https://react.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Framer Motion](https://www.framer.com/motion/)
- [Vitest](https://vitest.dev/)

---

**Happy coding! 🎉**
