-- Unique folder names among *live* folders only (trashed ones are ignored),
-- so you can recreate a name after moving the old one to trash.
-- NULL parentId is treated as '' for uniqueness at the drive root.

DROP INDEX IF EXISTS "Folder_userId_parentId_name_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "Folder_userId_parentId_name_uidx"
ON "Folder" ("userId", (COALESCE("parentId", '')), "name")
WHERE "deletedAt" IS NULL;
