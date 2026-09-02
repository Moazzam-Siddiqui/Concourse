# Deploying Concourse

Three services and a database, on free tiers that do not expire.

| Piece | Host | Why |
|---|---|---|
| Frontend | **Cloudflare Pages** | Free, global CDN, never sleeps |
| Backend | **Render** (Docker, free) | Sleeps when idle; wakes in ~50s |
| AI service | **Render** (Docker, free) | Same |
| Postgres | **Neon** | Free tier does not expire |

Postgres is on Neon rather than Render because Render's free database is deleted after 90
days. The backend only reads `DB_URL`, so the database can live anywhere that speaks
Postgres, and the choice is simply which free tier outlives the others.

---

## Before anything goes live

Two settings are safe on `localhost` and dangerous the moment the app has a public URL. The
`cloud` profile handles the second one for you; the first is on you.

**1. Generate a real JWT secret.**

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

Without `AUTH_JWT_SECRET`, the app falls back to
`dev-only-insecure-secret-change-me-in-any-real-deployment`, which is in this repo. Anyone
who can read the source can mint a valid admin token. The app warns about this at every
startup — do not deploy past that warning.

**2. Confirm the cloud profile is active.** `SPRING_PROFILES_ACTIVE=cloud` sets
`auth.reset.expose-code: false`. With it on, `/auth/forgot-password` returns the reset code
in the HTTP response — and that endpoint accepts any address with no proof of ownership, so
a public deployment with it enabled hands every account to whoever asks. The backend refuses
to start if it detects the two together, but set the profile deliberately rather than
relying on the guard.

---

## 1. Database — Neon

1. neon.tech → new project → copy the connection string.
2. Convert it to JDBC form. Neon gives you a `postgresql://user:pass@host/db` URL; Spring
   wants the pieces separately:

   ```
   DB_URL       jdbc:postgresql://ep-xxx.aws.neon.tech/neondb?sslmode=require
   DB_USERNAME  <user from the URL>
   DB_PASSWORD  <password from the URL>
   ```

   `sslmode=require` is not optional — Neon rejects unencrypted connections, and the failure
   reads as a generic connection timeout.

Flyway creates the schema on first boot. There are three migrations; you do not run anything
by hand.

## 2. Backend and AI service — Render

Dashboard → **New → Blueprint** → point it at this repo. It reads `render.yaml` and creates
both services.

Fill in the variables it prompts for (every one is marked `sync: false` in the blueprint
precisely so it has to ask):

| Variable | Value |
|---|---|
| `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` | from Neon, above |
| `AUTH_JWT_SECRET` | the string you generated |
| `CORS_ALLOWED_ORIGINS` | your Pages URL — **fill this in after step 3** |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | Gmail address + 16-char App Password |
| `AUTH_ADMIN_EMAILS` | the address that gets admin |
| `AUTH_ADMIN_PASSWORD` | the seeded admin password |

Note the backend's `AI_SERVICE_URL` is already set to `http://concourse-ai:8000` — Render's
internal hostname, so that traffic never leaves their network and does not wake the AI
service through the public internet.

## 3. Frontend — Cloudflare Pages

Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `VITE_API_BASE_URL` = your Render backend URL |

`VITE_API_BASE_URL` is read at **build** time, not runtime — it is compiled into the bundle.
Changing it later means triggering a rebuild, not just editing a setting.

## 4. Close the CORS loop

Pages gives you `https://<project>.pages.dev`. Put that into `CORS_ALLOWED_ORIGINS` on the
Render backend and let it redeploy.

Until you do, the frontend loads and every API call fails. The browser blocks the response
before your code sees it, so it presents as "the backend is down" rather than as a CORS
problem — check this first if the deployed site cannot log in.

---

## Two things that will look like bugs

**The first request after idle takes ~50 seconds.** Render's free tier stops a service after
15 minutes without traffic. The Pages frontend is always up, so the page paints instantly and
then appears to hang on the first API call. For anything you are sending to an interviewer,
point a free uptime pinger (UptimeRobot, cron-job.org) at
`https://<backend>.onrender.com/actuator/health` every 10 minutes and it never sleeps.

**The AI service may be OOM-killed on a layout upload.** OpenCV, scikit-image and RapidOCR in
a 512MB instance is tight. If `/layout/parse` kills the service, rebuild with
`WITH_LAYOUT: "false"` in `render.yaml`. `/analyze` and `/predict/risk` keep working,
`/health` reports `layout.available: false`, and the UI says AI tracing is unavailable —
which is the designed degradation, not a crash.

Also worth knowing before anyone asks: `torch` and `transformers` are not installed, so
`/predict/risk` answers with `local-linear`, the closed-form scorer, rather than the GNN.
That is the intended fallback and `/health` states it plainly.
