import DriveWorkspace from "@/components/DriveWorkspace";

export default function DrivePage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  return <DriveWorkspace query={searchParams.q} />;
}
