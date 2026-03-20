// ================================================================
//   화율인사이드 백엔드 서버
//   역할: 프론트엔드의 AI 요청을 받아서 Anthropic API에 대신 전달해주는
//        "중간 다리(프록시)" 역할을 합니다.
//        + 판례/사례/콘텐츠 데이터를 PostgreSQL 데이터베이스에 저장/관리합니다.
// ================================================================

// — 1. 필요한 도구(라이브러리) 불러오기 ————————————————————
const express = require("express");      // 서버를 쉽게 만들어주는 도구
const cors    = require("cors");         // 프론트엔드↔백엔드 통신을 허용해주는 도구
const path    = require("path");         // 파일 경로를 다루는 Node.js 기본 도구
require("dotenv").config();              // .env 파일에서 비밀 키를 읽어오는 도구
const { Pool } = require("pg");          // PostgreSQL 데이터베이스 연결 도구

// — 2. 서버 기본 설정 ——————————————————————————————
const app  = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: "1mb", type: "*/*" }));

app.use(cors({
    origin: "https://hwayul-frontend-bwjw.vercel.app"
}));

// — 보안: 요청 횟수 제한 (Rate Limiting) ——————————————
const requestCounts = new Map();
setInterval(() => requestCounts.clear(), 60000);

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
    console.error("════════════════════════════════════════════════════");
    process.exit(1);
}

// — 4. PostgreSQL 데이터베이스 연결 ————————————————————
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("railway")
        ? { rejectUnauthorized: false }
        : false
});

async function initDatabase() {
    try {
        // 판례/사례 테이블
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

        // 콘텐츠 테이블 (기존 콘텐츠 관리의 데이터)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contents (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50) DEFAULT 'news',
                tag VARCHAR(100),
                title VARCHAR(500) NOT NULL,
                date VARCHAR(20),
                summary TEXT,
                views INTEGER DEFAULT 0,
                hidden BOOLEAN DEFAULT false,
                body TEXT,
                attachments TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // 기존 테이블에 attachments 컬럼 추가
    await pool.query(`ALTER TABLE contents ADD COLUMN IF NOT EXISTS attachments TEXT`);

        console.log("✅ 데이터베이스 테이블 준비 완료!");
    } catch (error) {
        console.error("❌ 데이터베이스 연결 실패:", error.message);
    }
}

initDatabase();

// — 5. 판례/사례 API ————————————————————

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
        res.status(500).json({ error: "데이터를 불러오는데 실패했습니다." });
    }
});

app.get("/api/cases/:id", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "불러오기 실패" });
    }
});

app.post("/api/cases", async (req, res) => {
    try {
        const { title, category, summary, content, result: caseResult, source } = req.body;
        if (!title || !category) return res.status(400).json({ error: "제목과 카테고리는 필수입니다." });
        const r = await pool.query(
            `INSERT INTO cases (title, category, summary, content, result, source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [title, category, summary||"", content||"", caseResult||"", source||""]
        );
        res.status(201).json(r.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "저장 실패" });
    }
});

app.put("/api/cases/:id", async (req, res) => {
    try {
        const { title, category, summary, content, result: caseResult, source } = req.body;
        const r = await pool.query(
            `UPDATE cases SET title=$1, category=$2, summary=$3, content=$4, result=$5, source=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
            [title, category, summary, content, caseResult, source, req.params.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        res.json(r.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "수정 실패" });
    }
});

app.delete("/api/cases/:id", async (req, res) => {
    try {
        const r = await pool.query("DELETE FROM cases WHERE id=$1 RETURNING *", [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        res.json({ message: "삭제되었습니다." });
    } catch (error) {
        res.status(500).json({ error: "삭제 실패" });
    }
});

app.get("/api/cases/search/:keyword", async (req, res) => {
    try {
        const kw = `%${req.params.keyword}%`;
        const r = await pool.query(
            `SELECT * FROM cases WHERE title ILIKE $1 OR summary ILIKE $1 OR content ILIKE $1 ORDER BY created_at DESC`, [kw]
        );
        res.json(r.rows);
    } catch (error) {
        res.status(500).json({ error: "검색 실패" });
    }
});

// — 6. 콘텐츠 관리 API ————————————————————

app.get("/api/contents", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM contents ORDER BY created_at DESC");
        const rows = result.rows.map(r => ({...r, attachments: r.attachments ? JSON.parse(r.attachments) : []}));
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: "콘텐츠 불러오기 실패" });
    }
});

app.get("/api/contents/:id", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM contents WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        const row = {...result.rows[0], attachments: result.rows[0].attachments ? JSON.parse(result.rows[0].attachments) : []};
        res.json(row);
    } catch (error) {
        res.status(500).json({ error: "불러오기 실패" });
    }
});

app.post("/api/contents", async (req, res) => {
    try {
        const { type, tag, title, date, summary, views, hidden, body } = req.body;
        if (!title) return res.status(400).json({ error: "제목은 필수입니다." });
        const r = await pool.query(
            `INSERT INTO contents (type, tag, title, date, summary, views, hidden, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [type||"news", tag||"", title, date||new Date().toISOString().slice(0,10), summary||"", views||0, hidden||false, body||""]
        );
        res.status(201).json(r.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "저장 실패" });
    }
});

app.put("/api/contents/:id", async (req, res) => {
    try {
        const { type, tag, title, date, summary, views, hidden, body } = req.body;
        const r = await pool.query(
            `UPDATE contents SET type=$1, tag=$2, title=$3, date=$4, summary=$5, views=$6, hidden=$7, body=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
            [type, tag, title, date, summary, views, hidden, body, req.params.id]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        res.json(r.rows[0]);
    } catch (error) {
        res.status(500).json({ error: "수정 실패" });
    }
});

app.delete("/api/contents/:id", async (req, res) => {
    try {
        const r = await pool.query("DELETE FROM contents WHERE id=$1 RETURNING *", [req.params.id]);
        if (r.rows.length === 0) return res.status(404).json({ error: "찾을 수 없습니다." });
        res.json({ message: "삭제되었습니다." });
    } catch (error) {
        res.status(500).json({ error: "삭제 실패" });
    }
});

// 콘텐츠 일괄 저장 (프론트엔드에서 전체 데이터를 한번에 보낼 때)
app.post("/api/contents/bulk", async (req, res) => {
    try {
        const { contents } = req.body;
        if (!Array.isArray(contents)) return res.status(400).json({ error: "배열이 필요합니다." });

        await pool.query("DELETE FROM contents");
        for (const c of contents) {
            await pool.query(
                `INSERT INTO contents (type, tag, title, date, summary, views, hidden, body, attachments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [c.type||"news", c.tag||"", c.title||"", c.date||"", c.summary||"", c.views||0, c.hidden||false, c.body||"", JSON.stringify(c.attachments||[])]
            );
        }
        const result = await pool.query("SELECT * FROM contents ORDER BY created_at DESC");
        const rows = result.rows.map(r => ({...r, attachments: r.attachments ? JSON.parse(r.attachments) : []}));
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: "일괄 저장 실패" });
    }
});

// — 7. AI 챗봇 엔드포인트 ————————————————
app.post("/api/claude", async (req, res) => {
    try {
        if (!req.body || !req.body.messages || !Array.isArray(req.body.messages)) {
            return res.status(400).json({ error: { message: "잘못된 요청입니다." } });
        }

        const lastMessage = req.body.messages[req.body.messages.length - 1];
        if (lastMessage && lastMessage.content && lastMessage.content.length > 10000) {
            return res.status(400).json({ error: { message: "메시지가 너무 깁니다." } });
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(req.body),
        });

        const data = await response.json();
        if (!response.ok) {
            console.error("[Claude API 에러]", response.status, data);
            return res.status(response.status).json(data);
        }
        res.json(data);

    } catch (error) {
        console.error("[서버 에러]", error.message);
        res.status(500).json({ error: { message: "서버 내부 오류가 발생했습니다." } });
    }
});

// — 8. 상태 확인 ————————————————————
app.get("/api/health", async (req, res) => {
    let dbStatus = "disconnected";
    try { await pool.query("SELECT 1"); dbStatus = "connected"; } catch (e) { dbStatus = "error: " + e.message; }
    res.json({ status: "ok", message: "화율인사이드 백엔드 서버가 정상 작동 중입니다!", database: dbStatus, timestamp: new Date().toISOString() });
});

// — 9. React 빌드 파일 서빙 ————————————————
const buildPath = path.join(__dirname, "..", "hwayul-inside", "build");
const fs = require("fs");
if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath));
    app.get("*", (req, res) => { res.sendFile(path.join(buildPath, "index.html")); });
}

// — 10. 서버 시작! ——————————————————————————————
app.listen(PORT, () => {
    console.log("");
    console.log("════════════════════════════════════════════════════");
    console.log("│ ✅ 화율인사이드 백엔드 서버 시작!                    │");
    console.log(`│ 🌐 주소: http://localhost:${PORT}                   │`);
    console.log("│ 🗄️  데이터베이스: PostgreSQL 연결됨                   │");
    console.log("════════════════════════════════════════════════════");
    console.log("");
});
