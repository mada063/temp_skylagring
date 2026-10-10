import { requireUser } from "@/lib/auth";
import { ApiError, handle } from "@/lib/api";
import {
  appendUploadChunk,
  deleteUploadSession,
  readUploadSession,
  SessionError,
} from "@/lib/uploadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60 * 60 * 6;

type Ctx = { params: { id: string } };

/** Append one chunk to an upload session. Body = raw bytes. */
export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const maxFileSize = Math.max(1, user.maxUploadMb) * 1024 * 1024;
    const session = await readUploadSession(params.id);
    if (!session || session.userId !== user.id) {
      throw new ApiError(404, "Upload session not found.");
    }

    if (!req.body) throw new ApiError(400, "Empty chunk body.");

    const offset = Number(req.headers.get("x-chunk-offset") ?? NaN);
    if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
      throw new ApiError(400, "Missing or invalid X-Chunk-Offset header.");
    }

    try {
      const updated = await appendUploadChunk(
        params.id,
        offset,
        req.body,
        maxFileSize,
      );
      return { received: updated.received, size: updated.size };
    } catch (err) {
      if (err instanceof SessionError) {
        throw new ApiError(err.status, err.message);
      }
      throw err;
    }
  });
}

/** Abort and delete an in-progress upload session. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const session = await readUploadSession(params.id);
    if (!session || session.userId !== user.id) {
      throw new ApiError(404, "Upload session not found.");
    }
    await deleteUploadSession(params.id);
    return { ok: true };
  });
}
