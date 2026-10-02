import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { softDeleteFile } from "@/lib/trash";

type Params = { params: { id: string } };

function publicFile<T extends { size: bigint }>(file: T) {
  return { ...file, size: Number(file.size) };
}

// Rename and/or move a file.
export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const file = await prisma.file.findFirst({
      where: { id: params.id, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!file) throw new ApiError(404, "File not found.");

    const body = await req.json().catch(() => ({}));
    const data: { name?: string; folderId?: string | null } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError(400, "File name is required.");
      data.name = name;
    }

    if (body.folderId !== undefined) {
      const folderId = body.folderId ? String(body.folderId) : null;
      if (folderId) {
        const folder = await prisma.folder.findFirst({
          where: { id: folderId, userId: user.id, deletedAt: null },
          select: { id: true },
        });
        if (!folder) throw new ApiError(404, "Destination folder not found.");
      }
      data.folderId = folderId;
    }

    const updated = await prisma.file.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        folderId: true,
        updatedAt: true,
      },
    });
    return { file: publicFile(updated) };
  });
}

// Move a file to trash.
export async function DELETE(_req: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const ok = await softDeleteFile(user.id, params.id);
    if (!ok) throw new ApiError(404, "File not found.");
    return { ok: true };
  });
}
