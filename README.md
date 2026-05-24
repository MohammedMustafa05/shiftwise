# ShiftWise

AI-powered restaurant scheduling platform. Employers manage schedules on the web; employees use the mobile app.

## Monorepo structure

```
shiftwise/
├── apps/
│   ├── web/          # Vite + React + TypeScript (employer dashboard)
│   ├── mobile/       # Expo + React Native (employee app)
│   ├── api/          # Node.js + Express + TypeScript
│   └── ml-engine/    # Python + FastAPI (scheduling engine)
├── packages/
│   └── shared/       # Shared Zod schemas and TypeScript types
└── supabase/
    └── migrations/   # PostgreSQL schema migrations
```

## Prerequisites

- Node.js 20+
- Python 3.11+
- npm (workspaces)
- Supabase account (for database)
- Expo Go app (for mobile dev)

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, etc.
```

### 3. Run services

**API** (port 3001):

```bash
npm run dev:api
```

**Web** (port 5173):

```bash
npm run dev:web
```

**Mobile**:

```bash
npm run dev:mobile
```

**ML Engine** (port 8000):

```bash
cd apps/ml-engine
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Tech stack

| Layer   | Technology                          |
|---------|-------------------------------------|
| Web     | TypeScript, React, Vite, Tailwind   |
| Mobile  | Expo, React Native, TypeScript      |
| API     | Node.js, Express, TypeScript        |
| ML      | Python, FastAPI, pandas, scikit-learn |
| Database| PostgreSQL (Supabase)               |

## License

Private — all rights reserved.
