import { z } from "zod";

export const signup_val = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

export const signin_val = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(100),
});
