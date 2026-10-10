import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import { deleteFileBytes } from "@/lib/storage";
import { fileBaseName } from "@/lib/fileType";
import {
  deleteUploadSession,
  finalizeUploadSession,
  readUploadSession,
  SessionError,
} from "@/lib/uploadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

function publicFile<T extends { size: bigint; name: string }>(file: T) {
  return { ...file, name: fileBaseName(file.name), size: Number(file.size) };
}

const fileSelect = {
  id: true,
  name: true,
  mimeType: true,
  size: true,
  folderId: true,
  updatedAt: true,
} as const;

/** Finalize a fully-received chunked upload into a File row. */
export async function POST(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const session = await readUploadSession(params.id);
    if (!session || session.userId !== user.id) {
      throw new ApiError(404, "Upload session not found.");
    }

    const file = await prisma.file.create({
      data: {
        name: session.name,
        mimeType: session.mimeType,
        size: BigInt(session.size),
        userId: user.id,
        folderId: session.folderId,
      },
      select: fileSelect,
    });

    try {
      const written = await finalizeUploadSession(params.id, file.id);
      const updated = await prisma.file.update({
        where: { id: file.id },
        data: { size: BigInt(written) },
        select: fileSelect,
      });
      return { files: [publicFile(updated)] };
    } catch (err) {
      await prisma.file.delete({ where: { id: file.id } }).catch(() => {});
      await deleteFileBytes(file.id).catch(() => {});
      await deleteUploadSession(params.id).catch(() => {});
      if (err instanceof SessionError) {
        throw new ApiError(err.status, err.message);
      }
      throw err;
    }
  });
}
