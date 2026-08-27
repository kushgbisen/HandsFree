import { z } from 'zod';

export const ActionPlanSchema = z.object({
  action: z.enum(['click', 'type', 'navigate', 'scroll', 'wait']),
  target: z.string(),
  selector: z.string().optional(),
  value: z.string().optional(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ActionPlan = z.infer<typeof ActionPlanSchema>;
