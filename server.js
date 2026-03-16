// ================================================================
//   화율인사이드 백엔드 서버
//   역할: 프론트엔드의 AI 요청을 받아서 Anthropic API에 대신 전달해주는
//        "중간 다리(프록시)" 역할을 합니다.
//        + 판례/사례 데이터를 PostgreSQL 데이터베이스에 저장/관리합니다.
// ================================================================

// — 1. 필요한 도구(라이브러리) 불러오기 ————————————————————
const express = require("express");      // 서버를 쉽게 만들어주는 도구
const cors    = require("cors");         // 프론트엔드↔백엔드 통신을 허용해주는 도구
const path    = require("path");         // 파일 경로를 다루는 Node.js 기본 도구
require("dotenv").config();              // .env 파일에서 비밀 키를 읽어오는 도구
const { Pool } = require("pg");          // PostgreSQL 데이터베이스 연결 도구

// — 2. 서버 기본 설정 ——————————————————————————————
const app  = express();
const PORT = process.env.PORT || 4000; // 서버가 사용할 포트 번호 (기본 4000)

// JSON 형식의 요청을 읽을 수 있게 설정 (최대 1MB)
app.use(express.json({ limit: "1mb", type: "*/*" }));

// 개발 중에는 프론트엔드(3000번 포트)와 백엔드(4000번 포트)가 다른 주소이므로
// CORS를 허용해야 서로 통신할 수 있어요.
app.use(cors({
    origin: "https://hwayul-frontend-bwjw.vercel.app"
}));

// — 보안: 요청 횟수 제한 (Rate Limiting) ——————————————
// 같은 사람이 너무 많이 요청하면 차단해요 (1분에 10번까지만 허용)
const requestCounts = new Map();
setInterval(() => requestCounts.clear(), 60000); // 1분마다 초기화

app.use("/api/claude", (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.ip;
    const count = requestCounts.get(ip) || 0;
    if (count >= 10) {
        return res.status(429).json({
            error: { message: "요청이 너무 많습니다. 1분 후 다시 시도해주세요." }
        });
    }
    requestCounts.set(ip, count + 1);
    next();
});

// — 보안: 기본 보안 헤더 설정 ——————————————
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
});

// — 3. API 키 확인 ——————————————————————————————
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
    console.error("════════════════════════════════════════════════════");
    console.error("│  ❌ 오류: ANTHROPIC_API_KEY가 설정되지 않았습니다!     │");
    console.error("│                                                    │");
    console.error("│  .env 파일을 만들고 아래 내용을 입력하세요:            │");
    console.error("│    ANTHROPIC_API_KEY=sk-ant-여기에_실제_키_입력       │");
    console.error("════════════════════════════════════════════════════");
    process.exit(1); // API 키 없으면 서버 시작 안 함
}

// — 4. PostgreSQL 데이터베이스 연결 ————————————————————
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("railway")
        ? { rejectUnauthorized: false }
        : false
});

// 데이터베이스 테이블 자동 생성
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cases (
                id SERIAL PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                category VARCHAR(100) NOT NULL,
                summary TEXT,
                content TEXT,
                result VARCHAR(200),
                source VARCHAR(500),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("✅ 데이터베이스 테이블 준비 완료!");
    } catch (error) {
        console.error("❌ 데이터베이스 연결 실패:", error.message);
    }
}

initDatabase();

// — 5. 판례/사례 API 엔드포인트 ————————————————————

// (1) 전체 목록 조회
app.get("/api/cases", async (req, res) => {
    try {
        const { category } = req.query;
        let query = "SELECT * FROM cases ORDER BY created_at DESC";
        let params = [];

        if (category) {
            query = "SELECT * FROM cases WHERE category = $1 ORDER BY created_at DESC";
            params = [category];
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error("목록 조회 오류:", error.message);
        res.status(500).json({ error: "데이터를 불러오는데 실패했습니다." });
    }
});

// (2) 단일 조회
app.get("/api/cases/:id", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "해당 자료를 찾을 수 없습니다." });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("조회 오류:", error.message);
        res.status(500).json({ error: "데이터를 불러오는데 실패했습니다." });
    }
});

// (3) 새 자료 추가
app.post("/api/cases", async (req, res) => {
    try {
        const { title, category, summary, content, result: caseResult, source } = req.body;

        if (!title || !category) {
            return res.status(400).json({ error: "제목과 카테고리는 필수입니다." });
        }

        const queryResult = await pool.query(
            `INSERT INTO cases (title, category, summary, content, result, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [title, category, summary || "", content || "", caseResult || "", source || ""]
        );

        res.status(201).json(queryResult.rows[0]);
    } catch (error) {
        console.error("추가 오류:", error.message);
        res.status(500).json({ error: "데이터 저장에 실패했습니다." });
    }
});

// (4) 자료 수정
app.put("/api/cases/:id", async (req, res) => {
    try {
        const { title, category, summary, content, result: caseResult, source } = req.body;

        const queryResult = await pool.query(
            `UPDATE cases
             SET title = $1, category = $2, summary = $3, content = $4,
                 result = $5, source = $6, updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
            [title, category, summary, content, caseResult, source, req.params.id]
        );

        if (queryResult.rows.length === 0) {
            return res.status(404).json({ error: "해당 자료를 찾을 수 없습니다." });
        }

        res.json(queryResult.rows[0]);
    } catch (error) {
        console.error("수정 오류:", error.message);
        res.status(500).json({ error: "데이터 수정에 실패했습니다." });
    }
});

// (5) 자료 삭제
app.delete("/api/cases/:id", async (req, res) => {
    try {
        const queryResult = await pool.query(
            "DELETE FROM cases WHERE id = $1 RETURNING *",
            [req.params.id]
        );

        if (queryResult.rows.length === 0) {
            return res.status(404).json({ error: "해당 자료를 찾을 수 없습니다." });
        }

        res.json({ message: "삭제되었습니다.", deleted: queryResult.rows[0] });
    } catch (error) {
        console.error("삭제 오류:", error.message);
        res.status(500).json({ error: "데이터 삭제에 실패했습니다." });
    }
});

// (6) 검색 기능
app.get("/api/cases/search/:keyword", async (req, res) => {
    try {
        const keyword = `%${req.params.keyword}%`;
        const result = await pool.query(
            `SELECT * FROM cases
             WHERE title ILIKE $1 OR summary ILIKE $1 OR content ILIKE $1
             ORDER BY created_at DESC`,
            [keyword]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("검색 오류:", error.message);
        res.status(500).json({ error: "검색에 실패했습니다." });
    }
});

// — 6. 핵심 기능: /api/claude 엔드포인트 ————————————————
//   프론트엔드에서 AI 요청이 오면 이 함수가 처리합니다.
app.post("/api/claude", async (req, res) => {
    try {
        // — 보안: 입력값 검증 ——————————————
        if (!req.body || !req.body.messages || !Array.isArray(req.body.messages)) {
            return res.status(400).json({
                error: { message: "잘못된 요청입니다." }
            });
        }

        // 메시지가 너무 길면 차단 (10000자 제한)
        const lastMessage = req.body.messages[req.body.messages.length - 1];
        if (lastMessage && lastMessage.content && lastMessage.content.length > 10000) {
            return res.status(400).json({
                error: { message: "메시지가 너무 깁니다." }
            });
        }

        // (A) 프론트엔드가 보낸 데이터를 그대로 Anthropic API에 전달
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type":      "application/json",
                "x-api-key":         ANTHROPIC_API_KEY,     // 여기서 비밀 키를 붙여줌!
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

// — 7. 상태 확인용 엔드포인트 ————————————————————
//   서버가 잘 돌아가는지 확인할 때 사용 (브라우저에서 http://localhost:4000/api/health 접속)
app.get("/api/health", async (req, res) => {
    let dbStatus = "disconnected";
    try {
        await pool.query("SELECT 1");
        dbStatus = "connected";
    } catch (e) {
        dbStatus = "error: " + e.message;
    }

    res.json({
        status: "ok",
        message: "화율인사이드 백엔드 서버가 정상 작동 중입니다!",
        database: dbStatus,
        timestamp: new Date().toISOString(),
    });
});

// — 8. (배포용) React 빌드 파일 서빙 ————————————————
//   나중에 실제 배포할 때, 프론트엔드 빌드 파일도 이 서버에서 함께 제공할 수 있어요.
//   개발 중에는 이 부분이 자동으로 건너뛰어집니다.
const buildPath = path.join(__dirname, "..", "hwayul-inside", "build");
const fs = require("fs");
if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath));
    app.get("*", (req, res) => {
        res.sendFile(path.join(buildPath, "index.html"));
    });
    console.log("📦 프론트엔드 빌드 파일을 함께 서빙합니다.");
}

// — 9. 서버 시작! ——————————————————————————————
app.listen(PORT, () => {
    console.log("");
    console.log("════════════════════════════════════════════════════");
    console.log("│ ✅ 화율인사이드 백엔드 서버 시작!                    │");
    console.log(`│ 🌐 주소: http://localhost:${PORT}                   │`);
    console.log(`│ 🔑 API 키: ${ANTHROPIC_API_KEY.slice(0,12)}...                   │`);
    console.log("│ 🗄️  데이터베이스: PostgreSQL 연결됨                   │");
    console.log("════════════════════════════════════════════════════");
    console.log("");
});
