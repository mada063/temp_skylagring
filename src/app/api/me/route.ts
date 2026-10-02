import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ApiError, handle } from "@/lib/api";
import {
  MAX_UPLOAD_MB,
  MIN_UPLOAD_MB,
  MAX_UPLOAD_CONCURRENCY,
  MIN_UPLOAD_CONCURRENCY,
  MAX_SCAN_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
} from "@/lib/uploadLimit";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const usage = await prisma.file.aggregate({
      where: { userId: user.id },
      _sum: { size: true },
      _count: true,
    });
    return {
      user,
      usage: { bytes: Number(usage._sum.size ?? 0), files: usage._count },
    };
  });
}

// Update profile (name, image) and optionally change password.
export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const data: {
      name?: string | null;
      image?: string | null;
      passwordHash?: string;
      maxUploadMb?: number;
      uploadConcurrency?: number;
      scanConcurrency?: number;
    } = {};

    if (body.name !== undefined) {
      data.name = body.name ? String(body.name).trim() : null;
    }

    if (body.maxUploadMb !== undefined) {
      const mb = Math.round(Number(body.maxUploadMb));
      if (!Number.isFinite(mb) || mb < MIN_UPLOAD_MB || mb > MAX_UPLOAD_MB) {
        throw new ApiError(
          400,
          `Upload limit must be between ${MIN_UPLOAD_MB} and ${MAX_UPLOAD_MB} MB.`,
        );
      }
      data.maxUploadMb = mb;
    }

    if (body.uploadConcurrency !== undefined) {
      const n = Math.round(Number(body.uploadConcurrency));
      if (
        !Number.isFinite(n) ||
        n < MIN_UPLOAD_CONCURRENCY ||
        n > MAX_UPLOAD_CONCURRENCY
      ) {
        throw new ApiError(
          400,
          `Upload concurrency must be between ${MIN_UPLOAD_CONCURRENCY} and ${MAX_UPLOAD_CONCURRENCY}.`,
        );
      }
      data.uploadConcurrency = n;
    }

    if (body.scanConcurrency !== undefined) {
      const n = Math.round(Number(body.scanConcurrency));
      if (
        !Number.isFinite(n) ||
        n < MIN_SCAN_CONCURRENCY ||
        n > MAX_SCAN_CONCURRENCY
      ) {
        throw new ApiError(
          400,
          `Scan concurrency must be between ${MIN_SCAN_CONCURRENCY} and ${MAX_SCAN_CONCURRENCY}.`,
        );
      }
      data.scanConcurrency = n;
    }

    if (body.image !== undefined) {
      const image = body.image ? String(body.image) : null;
      if (image && !image.startsWith("data:image/")) {
        throw new ApiError(400, "Profile picture must be an image.");
      }
      if (image && image.length > 3_000_000) {
        throw new ApiError(400, "Profile picture is too large (max ~2 MB).");
      }
      data.image = image;
    }

    if (body.newPassword !== undefined) {
      const newPassword = String(body.newPassword);
      const currentPassword = String(body.currentPassword ?? "");
      if (newPassword.length < 8) {
        throw new ApiError(400, "New password must be at least 8 characters.");
      }
      const full = await prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!full || !(await verifyPassword(currentPassword, full.passwordHash))) {
        throw new ApiError(400, "Current password is incorrect.");
      }
      data.passwordHash = await hashPassword(newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
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
    return { user: updated };
  });
}
