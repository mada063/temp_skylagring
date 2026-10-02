import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

// Routes that require authentication (page routes).
const PROTECTED_PREFIXES = ["/drive", "/settings", "/trash"];
// Auth pages that a logged-in user should be bounced away from.
const AUTH_PAGES = ["/login", "/register"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await verifySession(token) : null;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (isProtected && !userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/drive";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/drive/:path*", "/settings/:path*", "/trash/:path*", "/login", "/register"],
};
