import { z } from 'zod';

// Common validation schemas
export const emailSchema = z.string().email('Invalid email address');
export const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name too long');

// Add your custom validation schemas here
