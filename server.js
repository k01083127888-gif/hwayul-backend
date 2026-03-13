// ═══════════════════════════════════════════════════════════════════
//  화율인사이드 백엔드 서버
//  역할: 프론트엔드의 AI 요청을 받아서 Anthropic API에 대신 전달해주는
//       "중간 다리(프록시)" 역할을 합니다.
//
//  왜 필요한가?
//  → API 키를 브라우저(프론트엔드)에 넣으면 누구나 볼 수 있어서 위험해요.
//    그래서 백엔드 서버가 API 키를 안전하게 보관하고,
//    프론트엔드 대신 Anthropic에 요청을 보내주는 거예요.
// ═══════════════════════════════════════════════════════════════════

// ── 1. 필요한 도구(라이브러리) 불러오기 ──────────────────────────────
const express = require("express");    // 서버를 쉽게 만들어주는 도구
const cors    = require("cors");       // 프론트엔드↔백엔드 통신을 허용해주는 도구
const path    = require("path");       // 파일 경로를 다루는 Node.js 기본 도구
require("dotenv").config();            // .env 파일에서 비밀 키를 읽어오는 도구

// ── 2. 서버 기본 설정 ─────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 4000; // 서버가 사용할 포트 번호 (기본 4000)

// JSON 형식의 요청을 읽을 수 있게 설정 (최대 1MB)
app.use(express.json({ limit: "1mb", type: "*/*" }));

// 개발 중에는 프론트엔드(3000번 포트)와 백엔드(4000번 포트)가 다른 주소이므로
// CORS를 허용해야 서로 통신할 수 있어요.
app.use(cors({
  origin: [
    "http://localhost:3000",   // create-react-app 기본 포트
    "http://localhost:5173",   // Vite 기본 포트
  ],
}));

// ── 3. API 키 확인 ────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error("╔═══════════════════════════════════════════════════════╗");
  console.error("║  ❌ 오류: ANTHROPIC_API_KEY가 설정되지 않았습니다!     ║");
  console.error("║                                                       ║");
  console.error("║  .env 파일을 만들고 아래 내용을 입력하세요:             ║");
  console.error("║  ANTHROPIC_API_KEY=sk-ant-여기에_실제_키_입력           ║");
  console.error("╚═══════════════════════════════════════════════════════╝");
  process.exit(1); // API 키 없으면 서버 시작 안 함
}

// ── 4. 핵심 기능: /api/claude 엔드포인트 ──────────────────────────
//    프론트엔드에서 AI 요청이 오면 이 함수가 처리합니다.
app.post("/api/claude", async (req, res) => {
  try {
    // (A) 프론트엔드가 보낸 데이터를 그대로 Anthropic API에 전달
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "x-api-key":        ANTHROPIC_API_KEY,       // 여기서 비밀 키를 붙여줌!
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),  // 프론트엔드가 보낸 내용 그대로 전달
    });

    // (B) Anthropic에서 받은 응답을 프론트엔드에 전달
    const data = await response.json();

    if (!response.ok) {
      // Anthropic API에서 에러가 온 경우
      console.error("[Claude API 에러]", response.status, data);
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (error) {
    // 네트워크 오류 등 예상치 못한 에러
    console.error("[서버 에러]", error.message);
    res.status(500).json({
      error: { message: "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }
    });
  }
});

// ── 5. 상태 확인용 엔드포인트 ─────────────────────────────────────
//    서버가 잘 돌아가는지 확인할 때 사용 (브라우저에서 http://localhost:4000/api/health 접속)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "화율인사이드 백엔드 서버가 정상 작동 중입니다!",
    timestamp: new Date().toISOString(),
  });
});

// ── 6. (배포용) React 빌드 파일 서빙 ──────────────────────────────
//    나중에 실제 배포할 때, 프론트엔드 빌드 파일도 이 서버에서 함께 제공할 수 있어요.
//    개발 중에는 이 부분이 자동으로 건너뛰어집니다.
const buildPath = path.join(__dirname, "..", "hwayul-inside", "build");
const fs = require("fs");
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(buildPath, "index.html"));
  });
  console.log("📦 프론트엔드 빌드 파일을 함께 서빙합니다.");
}

// ── 7. 서버 시작! ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log(`║  ✅ 화율인사이드 백엔드 서버 시작!                     ║`);
  console.log(`║  📡 주소: http://localhost:${PORT}                     ║`);
  console.log(`║  🔑 API 키: ${ANTHROPIC_API_KEY.slice(0,12)}...        ║`);
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
});
