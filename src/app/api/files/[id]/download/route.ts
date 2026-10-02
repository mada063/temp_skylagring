import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { fileExistsOnDisk, openFileStream } from "@/lib/storage";
import { fileBaseName } from "@/lib/fileType";

type Params = { params: { id: string } };

// Download (or inline-preview with ?inline=1) a file's bytes.
export async function GET(req: Request, { params }: Params) {
  const user = await requireUser().catch(() => null);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const file = await prisma.file.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
    select: {
      name: true,
      mimeType: true,
      size: true,
      data: { select: { bytes: true } },
    },
  });

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const disposition = inline ? "inline" : "attachment";
  const encodedName = encodeURIComponent(fileBaseName(file.name));
  const headers = {
    "Content-Type": file.mimeType || "application/octet-stream",
    "Content-Length": String(file.size),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };

  if (await fileExistsOnDisk(params.id)) {
    const stream = Readable.toWeb(openFileStream(params.id)) as ReadableStream;
    return new Response(stream, { status: 200, headers });
  }

  if (!file.data) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(file.data.bytes), { status: 200, headers });
}
