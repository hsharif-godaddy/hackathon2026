import { type RouteObject } from 'react-router-dom';
import { lazy } from 'react';

const HomePage = lazy(() => import('./pages/index'));
const AboutPage = lazy(() => import('./pages/about'));
const ServicesPage = lazy(() => import('./pages/services'));
const ContactPage = lazy(() => import('./pages/contact'));
const BlogPage = lazy(() => import('./pages/blog'));
const FaqPage = lazy(() => import('./pages/faq'));

export const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/about', element: <AboutPage /> },
  { path: '/services', element: <ServicesPage /> },
  { path: '/contact', element: <ContactPage /> },
  { path: '/blog', element: <BlogPage /> },
  { path: '/faq', element: <FaqPage /> },
];

export type Path = '/' | '/about' | '/services' | '/contact' | '/blog' | '/faq';
