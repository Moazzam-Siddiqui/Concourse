# CI/CD and Docker

Three independent things, deliberately kept apart:

| | What it is | Where |
|---|---|---|
| **The stack** | Postgres + AI service + backend + frontend, containerised | [`docker-compose.yml`](../docker-compose.yml) |
| **The PR gate** | GitHub Actions, which every pull request must pass | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| **The build server** | Jenkins, itself in a container, which builds and tests the above | [`ci/jenkins/`](../ci/jenkins/) |

You do not need Jenkins to run the stack, and you do not need the stack running to use Jenkins.

---

## Running the whole stack

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | <http://localhost:5173> |
| Backend | <http://localhost:8080/health> |
| AI service | <http://localhost:8000/health> |
| Postgres | `localhost:5432` (`concourse` / `concourse`) |

This runs the backend under its **cloud profile against Postgres**, which is the shape a real
deployment has. Running it locally with `./mvnw spring-boot:run` instead uses the H2 file and
needs none of this. Both read the same Flyway migrations — that they agree is the point.

Two consequences of the cloud profile worth knowing before you demo from containers:

- **Reset codes are not returned in the response.** `auth.reset.expose-code` is forced off, so
  the password-reset flow needs a configured mailbox to be demonstrable. The local H2 setup is
  the easier one to demo from.
- **`AUTH_JWT_SECRET` must not be the committed default.** Compose supplies a laptop-only value;
  the app refuses to boot on the development default under this profile, on purpose.

### Configuration

Everything is optional — the defaults boot. Put overrides in a `.env` next to
`docker-compose.yml`; see [`.env.docker.example`](../.env.docker.example).

```bash
DB_PASSWORD=...              # default: concourse-local-only
AUTH_JWT_SECRET=...          # default: a laptop-only string
AUTH_ADMIN_EMAILS=you@example.com   # default: empty, so no admin exists
AUTH_ADMIN_PASSWORD=...      # 8+ chars, a letter and a number; seeds the admin at boot
HF_API_TOKEN=...             # default: empty, so the offline model answers

# Host ports, for when something already owns the default
BACKEND_PORT=8080  AI_PORT=8000  FRONTEND_PORT=5173  POSTGRES_PORT=5432
```

### A smaller AI image

The layout pipeline (OpenCV, scikit-image, RapidOCR) is most of that image's size. Without it:

```bash
docker compose build --build-arg WITH_LAYOUT=false ai-service
```

`/analyze` still works. `/health` then reports `layout.available: false` and the UI says AI
tracing is unavailable, which is the documented degradation rather than a 404.

### The frontend's URLs are baked in, not read at runtime

Vite inlines `VITE_*` at build time, so an image built for `localhost` **cannot** be repointed
at a deployed backend with an environment variable on the container. A different target is a
rebuild:

```bash
docker compose build --build-arg VITE_API_BASE_URL=https://api.example.com frontend
```

---

## Jenkins

```bash
cd ci/jenkins
docker compose up -d --build
```

Then <http://localhost:8081> — 8081 because the backend owns 8080.

The first start asks for an unlock key:

```bash
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Choose **Install suggested plugins**, create the admin user, done. The plugins this pipeline
needs are already baked into the image ([`plugins.txt`](../ci/jenkins/plugins.txt)).

### Creating the job

New Item → **Pipeline** → Pipeline script from SCM → Git → this repo's URL, branch `main`,
script path `Jenkinsfile`.

### Why the setup wizard is left on

This container mounts the host's Docker socket so jobs can build images. Access to that socket
is root-equivalent on the host, so an unauthenticated Jenkins is not an open dashboard — it is
arbitrary code execution on the laptop it runs on. Skipping the wizard saves one paste and
costs that.

### Why the toolchains live in the Jenkins image

Jenkins reaches the host's daemon through the mounted socket, so any container a job starts is
a *sibling on the host*. A `-v $WORKSPACE:/src` inside a job therefore asks the host for a path
that only exists inside the Jenkins container, on a named volume — and Docker answers by
mounting an empty directory instead of failing. Installing JDK 21, Maven, Node 22 and Python
directly into the image sidesteps that. `docker build` still works over the socket, because the
CLI streams the build context rather than mounting it.

---

## The pipeline

[`Jenkinsfile`](../Jenkinsfile) at the repo root. Cheapest signal first, so a broken commit is
not made to wait on an image build before being told.

| Stage | What it proves |
|---|---|
| **Backend tests** | `mvn test` — 59 tests. Surefire XML published to Jenkins |
| **AI service tests** | `pytest` — 47 tests, layout extras installed so the 21 pipeline tests really run. Plus the `app.scoring` self-check |
| **Frontend tests** | `npm test` (23) and `npm run test:render` — every route and live component renders without throwing |
| **Build images** | All three images actually build |
| **Stack smoke test** | `docker compose up -d --wait` — every service reports **healthy**, not merely started |

The smoke stage is the one that earns its keep. `--wait` turns each service's `HEALTHCHECK`
into a build assertion, so a Spring app that boots and then dies in Flyway fails the build. A
plain `up -d` would call that a success, because it did start.

CI publishes on `15432 / 18000 / 18080 / 15173` and uses a per-build compose project name, so a
build never adopts or tears down the containers of a developer running the stack on the same
machine.

### `pytest` is not in `requirements.txt`

Deliberate. The service does not need it at runtime, and the pipeline installing it in one line
is cheaper than a runtime dependency list that lies about what the service requires.

---

## GitHub Actions — the PR gate

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Runs on every pull request and on every
push to `main`, and needs nothing installed: no Jenkins, no secrets, no `.env`. Every suite here is
self-contained — backend tests run on H2 rather than Postgres, `pytest` touches no network, and the
frontend's render smoke tests use `react-dom/server`, so no browser is involved.

| Job | Command |
|---|---|
| `backend` | `mvn -B -ntp test` |
| `ai-service` | `pytest tests -q`, then the `app.scoring` self-check |
| `frontend` | `npm test`, `npm run test:render`, `npm run build` |
| `mobile` | `flutter test` |
| `stack` | `docker compose build` then `up -d --wait` — waits on the four fast jobs first |

Two things Jenkins does not cover: the mobile suite, and `npm run build`. The rest is the same
commands, so a green Jenkins and a green Actions run mean the same thing.

**`main` is protected by a ruleset**: changes land through a pull request, and all five checks must
be green before the merge button unlocks. Nothing else is required — no approving review, and no
"branch must be up to date", so merging one PR does not invalidate the green run on every other.

```bash
gh pr checks           # from a branch with an open PR
gh api repos/{owner}/{repo}/rules/branches/main   # what is actually enforced
```

### Why the jobs have no `paths:` filters

A required check that is filtered out of a run still has to report something, and a check stuck at
"expected" blocks a pull request forever. Every job runs on every PR; the fast four finish in a
couple of minutes, which is cheaper than the class of bug that footgun produces.
