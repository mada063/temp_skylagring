import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";

/** Wraps a route handler, mapping thrown errors to JSON responses. */
export function handle<T>(
  fn: () => Promise<T>,
): Promise<NextResponse> {
  return fn()
    .then((data) => NextResponse.json(data ?? { ok: true }))
    .catch((err) => {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("API error:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    });
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
