/**
 * Merge duplicate folders that share the same userId + parentId + name
 * (created by earlier parallel-upload races), then add the unique index.
 *
 * Usage: node prisma/dedupe-folders.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dups = await prisma.$queryRaw`
    SELECT "userId", "parentId", "name", COUNT(*)::int AS n
    FROM "Folder"
    GROUP BY "userId", "parentId", "name"
    HAVING COUNT(*) > 1
  `;

  console.log(`Found ${dups.length} duplicate folder group(s).`);

  for (const g of dups) {
    const folders = await prisma.folder.findMany({
      where: {
        userId: g.userId,
        parentId: g.parentId,
        name: g.name,
      },
      include: { _count: { select: { files: true, children: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Keep the one with the most content; prefer oldest on a tie.
    folders.sort(
      (a, b) =>
        b._count.files + b._count.children - (a._count.files + a._count.children),
    );
    const [keep, ...extras] = folders;
    console.log(
      `  Keeping ${keep.id} for "${g.name}", merging ${extras.length} duplicate(s)`,
    );

    for (const extra of extras) {
      await prisma.file.updateMany({
        where: { folderId: extra.id },
        data: { folderId: keep.id },
      });
      await prisma.folder.updateMany({
        where: { parentId: extra.id },
        data: { parentId: keep.id },
      });
      await prisma.folder.delete({ where: { id: extra.id } });
    }
  }

  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "Folder_userId_parentId_name_uidx";
    CREATE UNIQUE INDEX IF NOT EXISTS "Folder_userId_parentId_name_uidx"
    ON "Folder" ("userId", (COALESCE("parentId", '')), "name")
    WHERE "deletedAt" IS NULL
  `);
  console.log("Partial unique index ensured (live folders only).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
