import {
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileType,
  BookOpen,
  Gamepad2,
  type LucideIcon,
} from "lucide-react";
import { categorize, type FileCategory } from "@/lib/fileType";

const ICONS: Record<FileCategory, { icon: LucideIcon; color: string }> = {
  image: { icon: FileImage, color: "text-emerald-400" },
  video: { icon: FileVideo, color: "text-rose-400" },
  audio: { icon: FileAudio, color: "text-fuchsia-400" },
  pdf: { icon: FileType, color: "text-red-400" },
  archive: { icon: FileArchive, color: "text-amber-400" },
  code: { icon: FileCode, color: "text-sky-400" },
  spreadsheet: { icon: FileSpreadsheet, color: "text-green-400" },
  document: { icon: FileText, color: "text-blue-400" },
  text: { icon: FileText, color: "text-slate-300" },
  ebook: { icon: BookOpen, color: "text-orange-400" },
  rom: { icon: Gamepad2, color: "text-violet-400" },
  other: { icon: File, color: "text-muted" },
};

export default function FileIcon({
  name,
  mimeType,
  className = "h-5 w-5",
}: {
  name: string;
  mimeType?: string;
  className?: string;
}) {
  const category = categorize(name, mimeType);
  const { icon: Icon, color } = ICONS[category];
  return <Icon className={`${className} ${color}`} />;
}
