import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

function withRefreshedCookies(
  response: NextResponse,
  destination: NextResponse,
) {
  response.cookies.getAll().forEach(({ name, value }) => {
    destination.cookies.set(name, value);
  });
  return destination;
}

export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/map") && !user) {
    const loginUrl = new URL("/auth", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return withRefreshedCookies(response, NextResponse.redirect(loginUrl));
  }

  if (pathname.startsWith("/auth") && pathname !== "/auth/callback" && user) {
    return withRefreshedCookies(response, NextResponse.redirect(new URL("/map", request.url)));
  }

  return response;
}

export const config = {
  matcher: ["/map/:path*", "/auth/:path*"],
};
