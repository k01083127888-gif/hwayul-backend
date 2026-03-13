# 화율인사이드 백엔드 서버 — 설치 가이드

## 이게 뭔가요?

프론트엔드(React 화면)에서 AI 기능을 사용하려면, 
Anthropic API 키를 안전하게 보관하고 대신 요청을 전달해주는 **백엔드 서버**가 필요해요.

이 서버가 바로 그 역할을 합니다.

```
[사용자 브라우저] → [이 백엔드 서버] → [Anthropic AI]
     화면에서           API 키를 붙여서      실제 AI가
     질문 입력          안전하게 전달         답변 생성
```

---

## 설치 순서 (총 4단계)

### 1단계: Anthropic API 키 발급받기

1. https://console.anthropic.com 에 접속 후 회원가입/로그인
2. 왼쪽 메뉴에서 "API Keys" 클릭
3. "Create Key" 버튼 클릭
4. 생성된 키를 복사해 두세요 (`sk-ant-...`로 시작하는 긴 문자열)

> ⚠️ 이 키는 비밀번호와 같아요! 다른 사람에게 공유하지 마세요.


### 2단계: 백엔드 폴더 설정

터미널(명령 프롬프트)을 열고 아래 명령어를 **한 줄씩** 입력하세요:

```bash
# hwayul-backend 폴더로 이동 (프로젝트 폴더 안에 넣었다고 가정)
cd hwayul-backend

# 필요한 도구(라이브러리) 설치
npm install
```

### 3단계: API 키 설정

hwayul-backend 폴더 안에 `.env` 라는 파일을 새로 만들고, 아래 내용을 입력하세요:

```
ANTHROPIC_API_KEY=sk-ant-여기에_1단계에서_복사한_키_붙여넣기
```

> 💡 `.env.example` 파일을 복사해서 이름을 `.env`로 바꿔도 됩니다.


### 4단계: 프론트엔드에 프록시 설정 추가

프론트엔드가 백엔드 서버를 찾을 수 있게 연결해줘야 해요.

#### create-react-app을 사용하는 경우

React 프로젝트(hwayul-inside)의 `package.json` 파일을 열고,
맨 아래쪽 `}` 바로 위에 이 한 줄을 추가하세요:

```json
  "proxy": "http://localhost:4000"
```

예를 들어 이런 모양이 됩니다:
```json
{
  "name": "hwayul-inside",
  "version": "0.1.0",
  "dependencies": { ... },
  "scripts": { ... },
  "proxy": "http://localhost:4000"
}
```

#### Vite를 사용하는 경우

React 프로젝트 최상위 폴더의 `vite.config.js` 파일을 열고 아래처럼 수정하세요:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
})
```

---

## 실행 방법

터미널 **2개**를 열어야 해요 (백엔드용 1개 + 프론트엔드용 1개):

### 터미널 1 — 백엔드 서버 시작
```bash
cd hwayul-backend
npm start
```
→ "✅ 화율인사이드 백엔드 서버 시작!" 메시지가 나오면 성공!

### 터미널 2 — 프론트엔드 시작
```bash
cd hwayul-inside
npm start          # create-react-app인 경우
# 또는
npm run dev        # Vite인 경우
```

→ 브라우저에서 화면이 열리면, AI 기능들이 정상 작동해요!

---

## 잘 되는지 확인하는 방법

브라우저 주소창에 아래 주소를 입력해 보세요:

```
http://localhost:4000/api/health
```

이런 응답이 나오면 백엔드가 정상입니다:
```json
{
  "status": "ok",
  "message": "화율인사이드 백엔드 서버가 정상 작동 중입니다!"
}
```

---

## 폴더 구조 (전체)

```
내프로젝트폴더/
├── hwayul-inside/        ← 프론트엔드 (React 화면)
│   ├── src/
│   ├── package.json      ← 여기에 proxy 설정 추가
│   └── ...
│
└── hwayul-backend/       ← 백엔드 (이 폴더)
    ├── server.js         ← 서버 코드
    ├── package.json
    ├── .env              ← API 키 (직접 만들어야 함)
    ├── .env.example      ← API 키 예시 파일
    └── .gitignore
```

---

## 자주 묻는 질문

**Q: "ANTHROPIC_API_KEY가 설정되지 않았습니다" 오류가 나요!**
→ `.env` 파일이 제대로 만들어졌는지 확인하세요. 파일 이름이 정확히 `.env`여야 합니다.

**Q: 프론트엔드에서 AI 기능이 여전히 안 돼요!**
→ 백엔드 서버(터미널 1)가 켜져 있는지 확인하세요. 프론트엔드와 백엔드 모두 동시에 실행되어야 해요.

**Q: API 키 요금이 발생하나요?**
→ Anthropic API는 사용량에 따라 요금이 부과됩니다. https://console.anthropic.com 에서 사용량을 확인할 수 있어요.
