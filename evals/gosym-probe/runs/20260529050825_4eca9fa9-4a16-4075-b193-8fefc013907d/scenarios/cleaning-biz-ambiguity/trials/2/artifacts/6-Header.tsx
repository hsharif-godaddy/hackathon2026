src/layouts/parts/Header.tsx [1-10 of 103] (truncated — use startLine/numLines to read remaining)
     1|import { Link, useLocation } from 'react-router-dom';
     2|import { Menu, X, Sparkles } from 'lucide-react';
     3|import { useState } from 'react';
     4|import { Button } from '@/components/ui/button';
     5|
     6|export default function Header() {
     7|  const location = useLocation();
     8|  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
     9|
    10|  const navItems = [