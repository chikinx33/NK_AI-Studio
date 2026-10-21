#!/usr/bin/env bash
# 클라우드 렌더러 굽기·배포: bash cloud-motion-renderer/deploy.sh
# 프로젝트 arboreal-lane-477616-d4(NK AI Studio), 미국 중부(us-central1) — 저장소 버킷과 같은 지역.
set -euo pipefail
PROJECT=arboreal-lane-477616-d4
REGION=us-central1
REPO=nk-motion
JOB=nk-motion-render
SA="nk-motion-render@${PROJECT}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(git -C "$ROOT" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/renderer:${TAG}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/ai-company-app/scripts"
cp "$ROOT/cloud-motion-renderer/Dockerfile" "$STAGE/"
for f in render-motion-page.mjs prepare-motion-assets.mjs motion-beats.mjs motion-cloud-job.mjs; do
  cp "$ROOT/ai-company-app/scripts/$f" "$STAGE/ai-company-app/scripts/"
done
cp -r "$ROOT/ai-company-app/motion-kit" "$STAGE/ai-company-app/motion-kit"
echo '{ "type": "module" }' > "$STAGE/ai-company-app/package.json"

gcloud builds submit "$STAGE" --project "$PROJECT" --region "$REGION" --tag "$IMAGE"
# 빌드에 올린 소스 묶음(키트 포함 약 150MB)은 남겨 두지 않는다
gcloud storage rm "gs://${PROJECT}_cloudbuild/source/**" --quiet || true
gcloud run jobs deploy "$JOB" --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --cpu 4 --memory 8Gi --tasks 1 --max-retries 0 --task-timeout 3600 --service-account "$SA"
# 이전 이미지는 지운다(저장 용량 무료 0.5GB 안에 두려고)
for digest in $(gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/renderer" --project "$PROJECT" --include-tags --format="value(version)" --filter="-tags:${TAG}"); do
  gcloud artifacts docker images delete "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/renderer@${digest}" --project "$PROJECT" --delete-tags --quiet || true
done
echo "배포 완료: $IMAGE"
