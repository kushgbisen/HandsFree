import { z } from 'zod';

export const VerifierResultSchema = z.object({
  success: z.boolean(),
  reason: z.string(),
});

export type VerifierResult = z.infer<typeof VerifierResultSchema>;
