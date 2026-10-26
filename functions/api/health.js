
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { status: "error", message: "D1 binding not found" },
        { status: 503 }
      );
    }

    const result = await env.DB.prepare(
      "SELECT 1 AS connected"
    ).first();

    return Response.json(
      {
        status: result?.connected === 1 ? "ok" : "error",
        database: "connected"
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow"
        }
      }
    );
  } catch (error) {
    console.error("Database health check failed", error);

    return Response.json(
      { status: "error", message: "Database check failed" },
      { status: 503 }
    );
  }
}
