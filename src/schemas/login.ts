import { z } from 'zod';

/**
 * Contract for a successful `POST /rest/user/login` response. Validating the shape (not
 * just the status code) catches silent API drift -- a renamed or dropped field fails the
 * test even when the HTTP status stays 200.
 *
 * `umail` is a plain string: that is the verified contract; validating it as an email
 * (`z.email()`) would over-constrain a field the API only guarantees to be a string.
 */
export const LoginResponseSchema = z.object({
  authentication: z.object({
    token: z.string(),
    bid: z.number(),
    umail: z.string(),
  }),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
