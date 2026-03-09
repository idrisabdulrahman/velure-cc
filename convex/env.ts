import { z } from 'zod'

const schema = z.object({
  SITE_URL: z.string().url().optional(),
  BETTER_AUTH_BASE_URL: z.string().url().optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(16),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = schema.parse(process.env)
