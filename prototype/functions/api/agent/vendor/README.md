# vendor/ — Workers 번들에 넣는 외부 라이브러리

Cloudflare Pages 배포는 이 저장소를 **빌드 없이** 서빙한다(빌드 산출물을 커밋해 두는 구조).
따라서 Functions 에서 `import "docxtemplater"` 같은 **bare specifier 는 해석되지 않는다** —
빌드 단계에서 `npm install` 이 돌지 않기 때문이다. 해석에 실패하면 Functions 번들 전체가
깨져 API 가 통째로 내려간다. 그래서 필요한 라이브러리를 **미리 번들해서 파일로 넣어 둔다.**

## 파일

| 파일 | 내용 | 라이선스 |
| --- | --- | --- |
| `docxtemplater-pizzip.bundle.js` | docxtemplater 3.69.3 + pizzip 3.2.0 (ESM, minified) | 둘 다 MIT/GPLv3 듀얼 → **MIT 선택** |
| `fflate.bundle.js` | fflate 0.8.2 의 `unzipSync·zipSync·strFromU8·strToU8` | MIT |
| `docxtemplater.LICENSE.md` · `pizzip.LICENSE.md` · `fflate.LICENSE.txt` | 원본 라이선스 전문 | — |

docxtemplater 의 **유료 모듈(xlsx·image·html·chart)은 포함하지 않는다.** 코어만 쓴다.

## 재생성 방법

라이브러리를 올릴 때는 아래를 그대로 다시 돌리고 결과 파일을 교체한다.

```bash
mkdir /tmp/nk-vendor && cd /tmp/nk-vendor && npm init -y
npm install docxtemplater@3.69.3 pizzip@3.2.0 fflate@0.8.2
printf 'import Docxtemplater from "docxtemplater";\nimport PizZip from "pizzip";\nexport { Docxtemplater, PizZip };\n' > entry-docx.mjs
printf 'export { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";\n' > entry-fflate.mjs
npx esbuild entry-docx.mjs   --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=docxtemplater-pizzip.bundle.js
npx esbuild entry-fflate.mjs --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=fflate.bundle.js
```

`--platform=browser` 가 중요하다. Node 전용 경로(fs·process)가 섞이면 Workers 에서 죽는다.
pizzip 의 `dist/pizzip.js` 는 `eval()` 을 쓰는 개발용 번들이라 Workers 에서 못 쓴다 —
위 방식(패키지 엔트리에서 직접 번들)은 그 파일을 타지 않는다.
