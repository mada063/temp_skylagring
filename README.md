# Skylagring

A simple, flat cloud-storage app built with **Next.js (App Router)**, **Prisma**, and
**PostgreSQL**. Files are stored as bytes directly in Postgres, so the database is the
only piece of infrastructure you need.

Design inspired by [dallastek.no](https://dallastek.no): flat, minimal, dark, no gradients.

## Features

- **Email + password auth** — bcrypt-hashed passwords, JWT session cookies, route protection via middleware.
- **Folder tree** in the center of the page showing all your content, expandable and navigable.
- **Left bar** with navigation and a live storage meter.
- **Profile menu** (top right) with Profile, Settings, and Logout.
- **Drag & drop upload** — drop OS files onto the drive or any folder.
- **Drag to move** — drag files/folders onto another folder to move them.
- **Search** across files and folders from the top bar.
- **Folder creation**, rename, and delete (with cascading delete).
- **File-type icons** for images, video, audio, PDF, archives, code, docs, and more.
- **Broad file support** — any file type; per-file size is configurable in Settings (up to 50 GB).
- **Profile settings** (name + profile picture) and **account settings** (password change, usage).

## Tech stack

| Concern       | Choice                                   |
| ------------- | ---------------------------------------- |
| Framework     | Next.js 14 (App Router, TypeScript)      |
| Styling       | Tailwind CSS (flat dark theme)           |
| Database      | PostgreSQL via Prisma                    |
| File storage  | Bytes stored in Postgres (`FileData`)    |
| Auth          | bcryptjs + `jose` JWT in an httpOnly cookie |
| Icons         | lucide-react                             |

## Getting started

### 1. Start PostgreSQL

With Docker (easiest):

```bash
docker compose up -d
```

…or point `DATABASE_URL` at any existing Postgres instance.

### 2. Configure environment

Copy the example env file and adjust if needed:

```bash
cp .env.example .env
```

Generate a strong `AUTH_SECRET` for production:

```bash
openssl rand -base64 32
```

### 3. Install dependencies

```bash
npm install
```

### 4. Create the database schema

```bash
npx prisma db push
```

### 5. Run the app

```bash
npm run dev
```

Open http://localhost:3000, create an account, and start uploading.

## Useful scripts

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start the dev server                     |
| `npm run build`     | Generate Prisma client + production build |
| `npm start`         | Run the production build                  |
| `npm run db:push`   | Push the Prisma schema to the database   |
| `npm run db:studio` | Open Prisma Studio to inspect data       |

## Project structure

```
src/
  app/
    api/            Route handlers (auth, folders, files, me)
    drive/          Protected drive UI (tree explorer)
    settings/       Profile & account settings
    login, register Auth pages
  components/        AppShell, DriveExplorer, settings panels, icons
  lib/              prisma, auth/session, password, file-type helpers
  middleware.ts     Route protection
prisma/schema.prisma
```

## Notes & possible next steps

- Files are stored on disk under `uploads/` (metadata in Postgres). For very large files, raise the limit in Settings.
- The storage meter fills per GB, cycling color each lap.
- Max upload size is configured per account in Settings (default 10 GB, max 50 GB).
```
