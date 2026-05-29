import { z } from 'zod';

export const CustomerBody = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).default(''),
  mobile: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['Active', 'Inactive']).default('Active'),
});

export const UpdateCustomerBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().max(254).optional(),
  mobile: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export const ListCustomersQuery = z.object({
  include: z.string().optional(),
});
