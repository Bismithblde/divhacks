export async function GET() {
  return Response.json(
    { status: "ok", service: "divhacks" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
