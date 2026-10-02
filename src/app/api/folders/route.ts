import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";

// List all folders for the current user (used to build the tree).
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const folders = await prisma.folder.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { id: true, name: true, parentId: true, updatedAt: true },
      orderBy: { name: "asc" },
    });
    return { folders };
  });
}

// Create a new folder.
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const parentId = body.parentId ? String(body.parentId) : null;

    if (!name) throw new ApiError(400, "Folder name is required.");
    if (name.length > 255) throw new ApiError(400, "Folder name is too long.");

    if (parentId) {
      const parent = await prisma.folder.findFirst({
        where: { id: parentId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new ApiError(404, "Parent folder not found.");
    }

    const folder = await prisma.folder.create({
      data: { name, parentId, userId: user.id },
      select: { id: true, name: true, parentId: true, updatedAt: true },
    });
    return { folder };
  });
}
