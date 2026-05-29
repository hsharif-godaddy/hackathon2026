src/pages/index.tsx [1-10 of 387] (truncated — use startLine/numLines to read remaining)
     1|import { Helmet } from '@dr.pogodin/react-helmet';
     2|import { motion, useScroll, useTransform } from 'motion/react';
     3|import { useRef } from 'react';
     4|import { Github, Linkedin, Twitter, Mail, ArrowDown } from 'lucide-react';
     5|import ProjectCard, { type Project } from '@/components/ProjectCard';
     6|
     7|const PROJECTS: Project[] = [
     8|  {
     9|    index: '01',
    10|    title: 'Meridian Brand Identity',