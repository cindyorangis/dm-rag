import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text");
  const voice = searchParams.get("voice") || "am_puck";

  if (!text) return new Response("No text provided", { status: 400 });

  // Pass the voice parameter to the Python server
  const response = await fetch(
    `http://localhost:8000/generate?text=${encodeURIComponent(text)}&voice=${voice}`,
  );

  return new Response(response.body, {
    headers: { "Content-Type": "audio/wav" },
  });
}
