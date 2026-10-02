import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { getDescendantIds, softDeleteFolder } from "@/lib/trash";

type Params = { params: { id: string } };

// Rename and/or move a folder.
export async function PATCH(req: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const folder = await prisma.folder.findFirst({
      where: { id: params.id, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw new ApiError(404, "Folder not found.");

    const body = await req.json().catch(() => ({}));
    const data: { name?: string; parentId?: string | null } = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new ApiError(400, "Folder name is required.");
      data.name = name;
    }

    if (body.parentId !== undefined) {
      const parentId = body.parentId ? String(body.parentId) : null;
      if (parentId) {
        const descendants = await getDescendantIds(user.id, params.id);
        if (descendants.includes(parentId)) {
          throw new ApiError(400, "Cannot move a folder into itself.");
        }
        const parent = await prisma.folder.findFirst({
          where: { id: parentId, userId: user.id, deletedAt: null },
          select: { id: true },
        });
        if (!parent) throw new ApiError(404, "Destination folder not found.");
      }
      data.parentId = parentId;
    }

    const updated = await prisma.folder.update({
      where: { id: params.id },
      data,
      select: { id: true, name: true, parentId: true, updatedAt: true },
    });
    return { folder: updated };
  });
}

// Move a folder (and everything inside it) to trash.
export async function DELETE(_req: Request, { params }: Params) {
  return handle(async () => {
    const user = await requireUser();
    const ok = await softDeleteFolder(user.id, params.id);
    if (!ok) throw new ApiError(404, "Folder not found.");
    return { ok: true };
  });
}
