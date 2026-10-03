import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
} from "@/lib/jwt";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  maxUploadMb: number;
  uploadConcurrency: number;
  scanConcurrency: number;
  createdAt: Date;
};

/** Creates a session cookie for the given user. */
export async function createSession(userId: string): Promise<void> {
  const token = await signSession(userId);
  // Only set Secure when explicitly enabled. Next inlines NODE_ENV at build
  // time, so defaulting to "production => secure" breaks plain-HTTP LXC deploys.
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env["COOKIE_SECURE"] === "true",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

/** Returns the currently authenticated user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = await verifySession(token);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      maxUploadMb: true,
      uploadConcurrency: true,
      scanConcurrency: true,
      createdAt: true,
    },
  });

  return user;
}

/** Like getCurrentUser but throws if unauthenticated (for API routes). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
