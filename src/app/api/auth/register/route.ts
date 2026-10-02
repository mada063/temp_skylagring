import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = body.name ? String(body.name).trim() : null;

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError(400, "Please enter a valid email address.");
    }
    if (password.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters.");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, "An account with that email already exists.");
    }

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true, email: true, name: true },
    });

    await createSession(user.id);
    return { user };
  });
}
