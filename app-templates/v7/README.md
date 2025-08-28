# V3 App Template

A modern, production-ready web application template built with Vite, React 19, Hono, and TypeScript. Designed for AI-assisted development with component introspection and excellent developer experience.

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
- **React 19** - Latest React with concurrent features
- **TypeScript 5** - Full type safety
- **Vite 6** - Fast build tool and dev server
- **Tailwind CSS 3** - Utility-first CSS framework
- **shadcn/ui** - Beautiful, accessible components
- **TanStack Query v5** - Data fetching and caching
- **React Router DOM v7** - Client-side routing

### Backend
- **Hono v4** - Ultra-fast, TypeScript-first web framework
- **Zod** - Schema validation
- **Node.js** - JavaScript runtime

### Development Tools
- **ESLint 9** - Code linting
- **Prettier** - Code formatting
- **Vitest** - Fast unit testing
- **TypeScript ESLint** - TypeScript-specific linting

> **Note:** SSR support with vite-plugin-ssr has been temporarily removed due to compatibility issues with the directory structure. This can be re-added later when the plugin is updated or replaced with a more stable alternative.

## 📁 Project Structure

```
v3-app-template/
├── src/
│   ├── frontend/           # Frontend React application
│   │   ├── components/     # React components
│   │   │   ├── ui/        # shadcn/ui base components
│   │   │   └── layout/    # Layout components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── api/           # API client layer
│   │   └── styles/        # Global styles
│   ├── backend/           # Backend Hono application
│   │   ├── api/           # API routes
│   │   └── middleware/    # Custom middleware
│   └── shared/            # Shared code between frontend/backend
│       ├── types/         # TypeScript type definitions
│       ├── utils/         # Shared utilities
│       └── constants/     # Shared constants
├── plugins/               # Custom Vite plugins
└── public/                # Static assets
```

## 📜 Available Scripts

- `npm run dev` - Start development servers with automatic port detection
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run type-check` - Run TypeScript type checking

## 🎨 UI Components

This template includes shadcn/ui components that are:
- **Accessible** - Built with Radix UI primitives
- **Customizable** - Easy to modify and extend
- **Consistent** - Design system with CSS variables
- **Copy-paste friendly** - Own your components

To add new shadcn/ui components:
```bash
npx shadcn-ui@latest add button
```

## 🧠 AI Integration

### Component Introspection

The custom Vite plugin adds source information to components in development:

```html
<div data-source-file="/src/client/components/Button.tsx" 
     data-source-line="15" 
     data-source-component="Button">
  Click Me
</div>
```

This helps AI tools understand your application structure.

### AI-Friendly Patterns

- **Consistent naming**: PascalCase components, camelCase hooks
- **Clear file structure**: Logical separation of concerns
- **Type-first approach**: Comprehensive TypeScript types
- **Standard patterns**: CRUD operations, form handling, error boundaries

## 🗃️ API Routes

The template includes a minimal API setup:

- `GET /api/health` - Health check endpoint

Ready for you to add your own API routes!

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
VITE_APP_NAME=V3 App Template
VITE_API_URL=http://localhost:3000/api
NODE_ENV=development
PORT=3000
```

### Custom Plugins

The source mapper plugin can be configured in `vite.config.ts`:

```typescript
sourceMapperPlugin({
  enabled: mode === 'development',
  include: /\.(tsx?|jsx?)$/,
})
```

## 🎯 Best Practices

### Component Architecture
- Keep components small and focused
- Use composition over inheritance
- Extract reusable logic into hooks
- Prefer function components with hooks

### State Management
- Use TanStack Query for server state
- Keep local state in components
- Use React Context for app-wide state
- Consider Zustand for complex client state

### API Design
- Use Zod for request validation
- Return consistent error responses
- Include proper HTTP status codes
- Log errors appropriately

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
- [Hono](https://hono.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [TanStack Query](https://tanstack.com/query/)

---

**Happy coding! 🎉**
