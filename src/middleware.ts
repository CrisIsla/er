import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import createMiddleware from "next-intl/middleware";
import { cookies } from "next/headers";

const LOCALES = ["en", "es"];
const DEFAULT_LOCALE = "en";

const intlMiddleware = createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
});

/**
 * Strips the default locale from the path ourselves.
 *
 * The default locale is not meant to be prefixed, and next-intl does redirect
 * /en to / -- but only for a bare path. Add a query string and the Location it
 * builds still carries the prefix, so /en?example=bank redirects to itself and
 * the browser gives up with ERR_TOO_MANY_REDIRECTS. That is the URL you get by
 * bookmarking or reloading an example, so it has to work.
 *
 * Matching is on whole segments, so a path like /english is left alone.
 */
const redirectAwayFromDefaultLocale = (req: NextRequest) => {
  const { pathname } = req.nextUrl;
  const prefix = `/${DEFAULT_LOCALE}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;

  const url = req.nextUrl.clone();
  // clone() keeps the search params, which is the whole point
  url.pathname = pathname.slice(prefix.length) || "/";
  return NextResponse.redirect(url);
};

const protectedRoutes = [
  "/user",
  "/user/shared",
  "/user/change-password",
  "/es/user",
  "/es/user/shared",
  "/es/user/change-password",
];
const publicRoutes = ["/login", "/register", "/es/login", "/es/register"];

async function verificarToken(token: string) {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (err) {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const withoutDefaultLocale = redirectAwayFromDefaultLocale(req);
  if (withoutDefaultLocale) return withoutDefaultLocale;

  const intlResponse = intlMiddleware(req);
  const path = req.nextUrl.pathname;

  // Verificación de token JWT
  const cookieStore = cookies();
  const token = cookieStore.get("token")?.value;
  const valid = token ? await verificarToken(token) : null;

  //Ruta privada sin token
  if (!valid && protectedRoutes.includes(path)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Si la ruta es pública pero loggeado
  if (publicRoutes.includes(path) && valid) {
    return NextResponse.redirect(new URL("user", req.url));
  }

  if (intlResponse) {
    return intlResponse;
  }

  return NextResponse.next();
}

export const config = {
  // Skip all paths that should not be internationalized. This example skips the
  // folders "api", "_next", "docs" and all files with an extension (e.g. favicon.ico)
  matcher: ["/((?!api|docs|_next|.*\\..*).*)"],
};
