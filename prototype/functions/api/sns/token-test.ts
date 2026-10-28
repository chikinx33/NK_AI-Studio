// Removed: legacy diagnostic exposed an Instagram token in HTML.
export const onRequestGet = () => new Response(JSON.stringify({ error: 'endpoint_removed', message: 'SNS 설정에서 계정을 연결해 주세요.' }), { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
