# NK_Studio 문서 변환기 — LibreOffice headless + 한글 폰트.
#
# ★fonts-noto-cjk 가 빠지면 PDF 의 한글이 전부 네모(tofu)로 나온다. 설계서 §6.4 의 최우선 확인 사항.
#   나눔(fonts-nanum)도 함께 넣어 두는 이유: 서식 템플릿이 '맑은 고딕·나눔고딕'을 지정한 경우
#   LibreOffice 가 비슷한 글꼴로 대체할 수 있어야 줄바꿈 위치가 원본과 덜 어긋난다.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-core \
      default-jre-headless \
      fonts-noto-cjk \
      fonts-noto-core \
      fonts-nanum \
      fonts-nanum-coding \
      fontconfig \
    && fc-cache -f \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice 는 쓸 수 있는 HOME 이 필요하다(프로필 생성). Cloud Run 은 /tmp 만 쓰기 가능.
ENV HOME=/tmp
ENV SOFFICE_BIN=/usr/bin/soffice

WORKDIR /app
COPY package.json ./
COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
