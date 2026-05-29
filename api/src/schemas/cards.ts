import { z } from 'zod';

export const IssueCardBody = z.object({
  id: z.string().min(1).max(120).optional(),
  uniqueId: z.string().uuid().optional(),
  customerId: z.string().min(1).max(120),
  campaignId: z.string().min(1).max(120),
  campaignName: z.string().min(1).max(200).optional(),
  templateSnapshot: z.record(z.unknown()).optional(),
});

export const UpdateCardBody = z.object({
  stamps: z.number().int().min(0).max(1000).optional(),
  status: z.enum(['Active', 'Redeemed']).optional(),
  completedDate: z.string().max(50).optional().nullable(),
  lastVisit: z.string().max(50).optional(),
});

export const TransactionBody = z.object({
  id: z.string().min(1).max(120).optional(),
  type: z.enum(['stamp_add', 'stamp_remove', 'redeem', 'issued']),
  amount: z.number().int().min(-100).max(100).default(0),
  date: z.string().min(1).max(80),
  timestamp: z.number().int().positive(),
  title: z.string().min(1).max(200),
  remarks: z.string().max(500).optional().nullable(),
});
