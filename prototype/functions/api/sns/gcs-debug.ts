// Legacy diagnostic removed: partial credential masking is not safe.
export const onRequestGet = () => new Response(JSON.stringify({ error: "endpoint_removed" }), { status: 410, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
