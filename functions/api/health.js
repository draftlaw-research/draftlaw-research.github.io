
export async function onRequestGet({ env }) {
  if (!env.EDITORIAL_DB) {
    return Response.json(
      { ok: false, message: "Database binding not found" },
      { status: 500 }
    );
  }

  try {
    await env.EDITORIAL_DB.prepare("SELECT 1").first();

    return Response.json({
      ok: true,
      message: "Editorial database connected successfully"
    });
  } catch {
    return Response.json(
      { ok: false, message: "Database connection failed" },
      { status: 500 }
    );
  }
}
