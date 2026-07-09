import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// NK 통합 빌드: nkstudio.org/ai-company/ 로 서빙되는 정적 산출물을 prototype/ai-company 로 출력.
export default defineConfig({
  plugins: [react()],
  base: "/ai-company/",
  build: {
    outDir: "../prototype/ai-company",
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
