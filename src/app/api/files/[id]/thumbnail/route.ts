import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getOrCreateThumbnail } from "@/lib/thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const user = await requireUser().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const file = await prisma.file.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
    select: { id: true, name: true, mimeType: true, updatedAt: true },
  });
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const thumb = await getOrCreateThumbnail(file.id, file.name, file.mimeType);
  if (!thumb) {
    return new Response("No thumbnail", { status: 404 });
  }

  return new Response(new Uint8Array(thumb), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(thumb.length),
      // File ids are immutable content addresses for our uploads; long cache
      // keeps scroll revisits cheap after the first decode.
      "Cache-Control": "private, max-age=604800, immutable",
      ETag: `"${file.id}-${file.updatedAt.getTime()}"`,
    },
  });
}
