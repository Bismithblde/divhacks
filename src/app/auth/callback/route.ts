import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/map";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const redirectTo = new URL(nextPath, url.origin);

  if (!code) {
    redirectTo.pathname = "/auth";
    redirectTo.searchParams.set("error", "The confirmation link is missing its code.");
    return NextResponse.redirect(redirectTo);
  }

  const supabase = await createClient();
  if (!supabase) {
    redirectTo.pathname = "/auth";
    redirectTo.searchParams.set(
      "error",
      "Supabase is not configured for this environment.",
    );
    return NextResponse.redirect(redirectTo);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    redirectTo.pathname = "/auth";
    redirectTo.searchParams.set("error", "That confirmation link has expired. Try again.");
  }

  return NextResponse.redirect(redirectTo);
}
