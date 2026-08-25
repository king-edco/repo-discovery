"use client";

import { createAuthClient } from "better-auth/react";

// Browser client for Better Auth. Talks to /api/auth/* on the same origin.
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut, updateUser } = authClient;
