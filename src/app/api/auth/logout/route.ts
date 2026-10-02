import { destroySession } from "@/lib/auth";
import { handle } from "@/lib/api";

export async function POST() {
  return handle(async () => {
    destroySession();
    return { ok: true };
  });
}
