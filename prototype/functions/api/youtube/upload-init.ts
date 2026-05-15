import { authorizeRequest } from "../_shared/auth.js";
import {
  ensureFreshAccessToken,
  YouTubeUploadInitRequest,
} from "../_shared/youtube-token";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type UploadInitBody = Partial<YouTubeUploadInitRequest>;

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  let body: UploadInitBody;
  try {
    body = (await request.json()) as UploadInitBody;
  } catch {
    return send({ error: "invalid_json" }, 400);
  }

  const title = String(body.title || "").trim();
  if (!title) return send({ error: "title_required" }, 400);

  const contentLength = Number(body.contentLength);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return send({ error: "contentLength_required" }, 400);
  }

  const contentType = String(body.contentType || "video/mp4").trim();
  const tags = Array.isArray(body.tags)
    ? body.tags.map(String).filter(Boolean)
    : String(body.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  const privacyStatus = body.privacyStatus || "private";
  const categoryId = String(body.categoryId || "22");

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken(env, auth.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "youtube_not_connected") return send({ error: msg }, 412);
    return send({ error: msg }, 500);
  }

  const metadata = {
    snippet: {
      title,
      description: String(body.description || ""),
      tags,
      categoryId,
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(contentLength),
        "X-Upload-Content-Type": contentType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    return send({ error: "youtube_init_failed", status: initRes.status, detail: errText }, 502);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    return send({ error: "missing_upload_url" }, 502);
  }

  return send({
    ok: true,
    uploadUrl,
    contentType,
    contentLength,
  });
};
