# Deploy CollabCode (Render + Supabase)

## Firebase vs Supabase — which to use?

**Use Supabase (PostgreSQL), not Firebase**, for this project.

| | Supabase | Firebase |
|---|----------|----------|
| Your backend | Already uses `pg` + SQL | Would need full rewrite |
| Change history | Same tables, zero logic change | New Firestore SDK + rules |
| Free tier | Yes | Yes |
| Best for | SQL logs, relations | Mobile apps, auth-heavy apps |

`DATABASE_URL=postgres://localhost...` only works on **your PC**. On Render you must set a **cloud** Postgres URL.

---

## Step 1: Supabase database (free, ~5 min)

1. Go to [supabase.com](https://supabase.com) → New project.
2. **Project Settings → Database → Connection string**
3. Choose **URI** tab, mode **Session** (or Transaction pooler).
4. Copy the URL and replace `[YOUR-PASSWORD]` with your DB password.
5. Optional: run `backend/migrations/001_change_history.sql` in **SQL Editor** (table is also auto-created on server start).

Example shape:

```
postgresql://postgres.xxxxx:YOUR_PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

---

## Step 2: Deploy backend on Render

1. [render.com](https://render.com) → **New → Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance:** Free is OK (cold starts ~50s)

3. **Environment variables** (Render dashboard → Environment):

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Supabase URI from Step 1 |
| `FRONTEND_URL` | Your frontend URL, e.g. `https://collabcode.onrender.com` or Vercel URL |
| `NODE_ENV` | `production` |

4. Deploy → copy your backend URL, e.g. `https://collabcode-api.onrender.com`

**Do not** put localhost in `DATABASE_URL` on Render.

---

## Step 3: Deploy frontend

### Option A — Render Static Site

- **Root Directory:** `frontend`
- **Build:** `npm install && npm run build`
- **Publish directory:** `dist`

Environment:

| Key | Value |
|-----|--------|
| `VITE_API_URL` | `https://collabcode-api.onrender.com` (your backend URL, no trailing slash) |
| `VITE_RAPIDAPI_KEY` | your key |
| `VITE_GEMINI_API_KEY` | your key |

### Option B — Vercel / Netlify

Same `VITE_*` variables in the project settings. Build command: `npm run build`, output: `dist`.

After deploy, set backend `FRONTEND_URL` to your real frontend URL (must match exactly, including `https`).

---

## Step 4: Verify

1. Open frontend → create session → edit code → open **History** → entries should appear.
2. Render backend **Logs** should show: `Change history: PostgreSQL connected`
3. If you see `WARNING: DATABASE_URL not set` → fix env var and redeploy.

---

## Alternative: Render Postgres (no Supabase)

1. Render → **New → PostgreSQL**
2. Copy **Internal Database URL** (if backend on same Render account) or **External** URL
3. Set as `DATABASE_URL` on your web service

Works with the same code; Supabase UI/SQL editor is often easier for beginners.

---

## Local development

**backend/.env**

```
PORT=3001
DATABASE_URL=postgresql://...   # optional locally; omit = JSON file fallback
FRONTEND_URL=http://localhost:5173
```

**frontend/.env**

```
VITE_API_URL=http://localhost:3001
```

---

## Common mistakes

- `DATABASE_URL` still pointing to `localhost` on Render → history never persists.
- `VITE_API_URL` not set on frontend build → still calls `localhost:3001` for users.
- `FRONTEND_URL` mismatch → CORS/socket issues; use exact deployed frontend URL.
- Render free backend sleeps → first request slow; upgrade or use a ping service if needed.
