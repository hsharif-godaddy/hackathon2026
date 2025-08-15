'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  SparklesIcon,
  ArrowLeftIcon,
  DocumentTextIcon,
  CpuChipIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ClockIcon,
  MapIcon
} from '@heroicons/react/24/outline'

interface BuildStep {
  id: string
  title: string
  status: 'pending' | 'building' | 'complete'
  duration: number
  startTime?: number
}

interface Artifact {
  id: string
  title: string
  icon: any
  content: string
  complete: boolean
}

export default function Build() {
  const [currentStep, setCurrentStep] = useState(0)
  const [activeTab, setActiveTab] = useState('sitemap')
  const [buildSteps] = useState<BuildStep[]>([
    { id: 'analysis', title: 'Analyzing Requirements', status: 'complete', duration: 2000 },
    { id: 'techstack', title: 'Designing Tech Stack', status: 'complete', duration: 3000 },
    { id: 'sitemap', title: 'Creating Site Architecture', status: 'complete', duration: 2500 },
    { id: 'planning', title: 'Finalizing Development Plan', status: 'complete', duration: 1500 }
  ])

  const [artifacts] = useState<Artifact[]>([
    {
      id: 'sitemap',
      title: 'Site Map',
      icon: MapIcon,
      complete: true,
      content: `# FitStudio Pro - Site Map

## 🌐 Public Website

### 🏠 Homepage (/)
- **Hero Section**
  - Studio introduction & value proposition
  - "Join Today" CTA with membership signup
  - Featured class of the day
- **Services Overview**
  - Personal Training preview
  - Group Classes preview  
  - Nutrition Coaching preview
- **Social Proof**
  - Member success stories carousel
  - Trainer credentials highlights
- **Contact Information**
  - Studio location with map
  - Hours of operation
  - Phone & email contact

### 📖 About (/about)
- **Our Story**
  - Founding mission and values
  - Studio philosophy and approach
- **Meet the Team**
  - Trainer profiles with specialties
  - Certifications and experience
- **Facility**
  - Photo gallery of equipment
  - Virtual tour option

### 💪 Services (/services)
- **Personal Training** (/services/personal-training)
  - One-on-one session details
  - Trainer matching system
  - Pricing and packages
- **Group Classes** (/services/group-classes)
  - Class types and descriptions
  - Schedule overview
  - Difficulty levels
- **Nutrition Coaching** (/services/nutrition)
  - Meal planning services
  - Consultation options
  - Success stories

### 📅 Classes (/classes)
- **Weekly Schedule**
  - Interactive calendar view
  - Filter by class type/instructor
- **Class Details**
  - Prerequisites and equipment needed
  - Instructor information
- **Booking System**
  - Real-time availability
  - Member login required for booking

### 📝 Blog (/blog)
- **Fitness Tips**
  - Exercise guides and tutorials
  - Workout routines
- **Nutrition Articles**
  - Healthy recipes
  - Supplement guidance
- **Studio News**
  - Events and challenges
  - Member spotlights

### 💳 Membership (/membership)
- **Pricing Plans**
  - Monthly and annual options
  - Family and student discounts
- **Benefits Overview**
  - What's included in each tier
- **Free Trial**
  - Guest pass signup
  - First consultation booking

---

## 🔐 Member Portal (/portal)

### 🏠 Dashboard (/portal/dashboard)
- **Welcome Section**
  - Personalized greeting
  - Progress summary
- **Today's Activities**
  - Booked classes
  - Scheduled training sessions
- **Quick Actions**
  - Book a class
  - View workout plan
  - Message trainer

### 📅 My Classes (/portal/classes)
- **Upcoming Bookings**
  - Class details and location
  - Cancellation options
- **Class History**
  - Attendance record
  - Performance notes
- **Available Classes**
  - Real-time booking
  - Waitlist options

### 🏋️ Workout Plans (/portal/workouts)
- **Current Program**
  - Trainer-assigned workouts
  - Video demonstrations
- **Exercise Library**
  - Searchable exercise database
  - Proper form instructions
- **Progress Tracking**
  - Weight and rep logging
  - Performance analytics

### 📊 Progress (/portal/progress)
- **Goals & Milestones**
  - Personal fitness objectives
  - Achievement tracking
- **Body Metrics**
  - Weight and measurement logs
  - Progress photos
- **Workout Statistics**
  - Attendance patterns
  - Performance trends

### 🥗 Nutrition (/portal/nutrition)
- **Meal Plans**
  - Personalized nutrition guides
  - Shopping lists
- **Recipe Database**
  - Healthy meal ideas
  - Macro-friendly options
- **Hydration & Supplements**
  - Daily tracking tools
  - Supplement recommendations

### ⚙️ Profile (/portal/profile)
- **Personal Information**
  - Contact details
  - Emergency contacts
- **Membership Details**
  - Current plan and billing
  - Renewal options
- **Preferences**
  - Notification settings
  - Class preferences

---

## 🛠️ Admin Interface (/admin)

### 📝 Content Management
- **Homepage Updates**
  - Hero content editing
  - Featured content management
- **Blog Management**
  - Article creation and editing
  - Publishing schedule
- **Class Scheduling**
  - Add/modify classes
  - Instructor assignments

### 👥 Member Management
- **Member Directory**
  - Contact information
  - Membership status
- **Class Rosters**
  - Attendance tracking
  - Capacity management
- **Communication Tools**
  - Email announcements
  - Member messaging

### 💰 Business Operations
- **Payment Tracking**
  - Membership renewals
  - Payment history
- **Analytics Dashboard**
  - Member engagement metrics
  - Revenue reporting
- **Equipment Management**
  - Maintenance schedules
  - Usage tracking

---

## 🔍 Technical Pages

### 🔒 Authentication
- **Login** (/login)
- **Registration** (/register)
- **Password Reset** (/forgot-password)

### 📄 Legal & Support
- **Privacy Policy** (/privacy)
- **Terms of Service** (/terms)
- **Contact Us** (/contact)
- **FAQ** (/faq)

### 🔧 Utility Pages
- **404 Error** (/404)
- **Maintenance** (/maintenance)
- **Thank You** (/thank-you)

---

## 🌍 SEO & Navigation Strategy

### Primary Navigation
1. **Home** → Homepage
2. **About** → Studio information
3. **Services** → Service details
4. **Classes** → Schedule & booking
5. **Blog** → Content & tips
6. **Membership** → Pricing & signup

### Member Portal Navigation
1. **Dashboard** → Overview
2. **Classes** → Booking & history
3. **Workouts** → Exercise plans
4. **Progress** → Tracking & goals
5. **Nutrition** → Meal planning
6. **Profile** → Account settings

### Footer Links
- Quick links to key pages
- Social media integration
- Contact information
- Legal pages

This site map ensures a logical flow for both new visitors converting to members and existing members accessing their personalized features.`
    },
    {
      id: 'techstack',
      title: 'Tech Stack Plan',
      icon: CpuChipIcon,
      complete: true,
      content: `# FitStudio Pro - Technical Architecture

## 🎯 Project Overview
**Application Type**: Fitness Studio Website & Member Portal
**Primary Framework**: Next.js 14 with App Router
**Development Approach**: API-first with integrated CMS

## 🛠️ Core Technology Stack

### Frontend Framework
- **Next.js 14+** - React-based full-stack framework
- **React 18+** - Component-based UI library
- **TypeScript** - Type-safe development

### Content Management
- **Payload CMS** - Code-first headless CMS
- **Rich Text Editor** - For blog posts and content
- **Media Management** - Image/video uploads and optimization

### Styling & UI
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - High-quality React components
- **Responsive Design** - Mobile-first approach

### Backend & Database
- **Next.js API Routes** - Serverless backend functions
- **Prisma ORM** - Type-safe database access
- **PostgreSQL** - Primary database for all data
- **Redis** - Session management and caching

### Authentication & Security
- **NextAuth.js** - Complete authentication solution
- **Role-based Access** - Studio Owner, Trainers, Members
- **Session Management** - Secure member login

### Business Features
- **Stripe Integration** - Payment processing for memberships
- **Email Automation** - Mailchimp for member communications
- **Calendar Integration** - Google Calendar for class scheduling
- **Booking System** - Custom class reservation system

### Development & Deployment
- **Vitest** - Fast unit testing framework
- **Playwright** - End-to-end testing
- **ESLint + Prettier** - Code quality and formatting
- **pnpm** - Fast, efficient package management

## 🏗️ Architecture Decision Rationale

### Why This Stack?
1. **Payload CMS**: Provides the content management capabilities while being developer-friendly and type-safe
2. **Next.js**: Handles both the public website and member portal in one application
3. **PostgreSQL**: Robust enough for member data, class schedules, and booking history
4. **Stripe**: Industry standard for fitness memberships and payments
5. **TypeScript**: Ensures reliability across all the integrated systems

### Scalability Considerations
- **Database Optimization**: Indexed queries for class schedules and member lookups
- **Caching Strategy**: Redis for frequently accessed class schedules and member sessions
- **Image Optimization**: Next.js automatic optimization for trainer photos and workout images
- **API Rate Limiting**: Protection for booking endpoints during peak times

## 🔧 Key Integrations

### Member Portal Features
- Secure login with role-based access
- Personal workout plan viewing
- Class booking and cancellation
- Progress tracking dashboard
- Nutrition tip access

### Content Management
- Easy class schedule updates via Payload CMS
- Blog post creation for fitness tips
- Success story management
- Trainer profile updates

### Business Operations
- Automated email reminders for upcoming classes
- Payment processing for new memberships
- Integration with studio's existing Google Calendar
- Member check-in tracking

This architecture provides a solid foundation for FitStudio Pro while maintaining flexibility for future enhancements.`
    }
  ])

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'agent',
      content: "Hello! I'm ArchBot-SYS, your Software Architect. I've received the detailed requirements from ProdBot-PM for FitStudio Pro. Let me analyze the requirements and design the optimal technical architecture.",
      timestamp: new Date(Date.now() - 45000)
    },
    {
      id: 2,
      sender: 'agent',
      content: "Based on the requirements, I can see we need: 1) A public website for marketing, 2) A member portal for bookings and progress, 3) Content management for the studio owner, 4) Payment processing, and 5) Email automation. Perfect use case for our CMS starter template!",
      timestamp: new Date(Date.now() - 35000)
    },
    {
      id: 3,
      sender: 'agent',
      content: "I'm designing the tech stack around Payload CMS for content management, Next.js for the full-stack application, and integrating Stripe for payments. This will give the studio owner an easy way to manage content while providing powerful member features.",
      timestamp: new Date(Date.now() - 25000)
    },
    {
      id: 4,
      sender: 'agent',
      content: "Now I'm creating the site architecture. The public site needs to convert visitors to members, while the member portal needs to be intuitive for non-technical users. I'm also planning the admin interface for easy content management.",
      timestamp: new Date(Date.now() - 15000)
    },
    {
      id: 5,
      sender: 'agent',
      content: "Perfect! I've completed the technical architecture and site structure. The tech stack leverages our proven CMS template while adding fitness-specific features. Ready to review the artifacts - tech stack plan and site architecture are both complete!",
      timestamp: new Date(Date.now() - 5000)
    }
  ])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                  <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  Airo
                </span>
              </Link>
              <div className="h-6 w-px bg-gray-300" />
              <span className="text-gray-600">Building FitStudio Pro</span>
            </div>
            <Link
              href="/app-plan"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-2" />
              Back to Planning
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Side - Agent Progress */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg flex items-center justify-center mr-3">
                  <CpuChipIcon className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">ArchBot-SYS</h2>
                  <p className="text-sm text-blue-600">Software Architect Agent</p>
                </div>
              </div>
              
              <div className="space-y-4">
                {buildSteps.map((step, index) => (
                  <div key={step.id} className="flex items-center">
                    <div className="flex-shrink-0 mr-3">
                      {step.status === 'complete' ? (
                        <CheckCircleIcon className="w-5 h-5 text-green-500" />
                      ) : step.status === 'building' ? (
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <ClockIcon className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${
                        step.status === 'complete' ? 'text-gray-900' : 
                        step.status === 'building' ? 'text-blue-600' : 'text-gray-400'
                      }`}>
                        {step.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Messages */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900">Agent Activity</h3>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className="flex items-start space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <SparklesIcon className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <div className="bg-gray-100 rounded-lg p-3">
                        <p className="text-sm text-gray-900">{message.content}</p>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Side - Artifacts */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="border-b border-gray-200">
                <div className="flex items-center justify-between p-6">
                  <h2 className="text-2xl font-bold text-gray-900">Architecture Artifacts</h2>
                  <div className="flex items-center text-sm text-green-600">
                    <CheckCircleIcon className="w-4 h-4 mr-1" />
                    All artifacts complete
                  </div>
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      onClick={() => setActiveTab(artifact.id)}
                      className={`flex items-center px-6 py-3 border-b-2 font-medium text-sm transition-colors ${
                        activeTab === artifact.id
                          ? 'border-purple-500 text-purple-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <artifact.icon className="w-4 h-4 mr-2" />
                      {artifact.title}
                      {artifact.complete && (
                        <CheckCircleIcon className="w-4 h-4 ml-2 text-green-500" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Artifact Content */}
              <div className="p-6">
                {artifacts.map((artifact) => (
                  <div
                    key={artifact.id}
                    className={activeTab === artifact.id ? 'block' : 'hidden'}
                  >
                    <div className="max-w-none text-gray-900 [&_h1]:text-gray-900 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-gray-900 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h3]:text-gray-900 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mb-2 [&_p]:text-gray-800 [&_p]:mb-4 [&_li]:text-gray-800 [&_ul]:mb-4 [&_ol]:mb-4 [&_strong]:text-gray-900 [&_strong]:font-semibold">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                      >
                        {artifact.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex gap-4">
              <button className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:shadow-lg transition-all duration-200">
                Continue to Development
              </button>
              <button className="px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors">
                Download Artifacts
              </button>
              <button className="px-6 py-3 text-purple-600 font-semibold hover:bg-purple-50 rounded-lg transition-colors">
                Modify Architecture
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
