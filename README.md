# SC Hauling Companion

Client-only web app for Star Citizen players: suggests commodity trades along an ordered list of
terminals you have to visit anyway for hauling missions. Price data comes from the public
[UEX Corp API 2.0](https://uexcorp.space/api/documentation) (no API key). The full specification is
in [`docs/SPEC.md`](docs/SPEC.md).

## Requirements

Only **Docker / Docker Compose** and **git (+ git flow)**. No Node.js is needed on the host; every
build, dev, test, lint and scaffold command runs in a container.

## Commands

```bash
docker compose up dev            # dev server on http://localhost:5173 (hot reload)
docker compose run --rm test     # unit tests
docker compose run --rm lint     # oxlint (type-aware) + TypeScript 7 typecheck
docker compose up --build app    # production build on http://localhost:8080
```

`node_modules` lives in a named Docker volume, never on the host. When dependencies change:

```bash
docker compose run --rm dev npm install <pkg>   # updates package.json / package-lock.json
docker compose build
docker compose down -v                          # drop the stale node_modules volume
```

Other useful one-offs:

```bash
docker compose run --rm test npm run test -- --run --coverage   # coverage report
docker compose run --rm dev npm run format                      # prettier
```

## Git workflow

- git flow: production `master`, integration `develop`, prefixes `feature/`, `bugfix/`, `release/`,
  `hotfix/`, empty version tag prefix (tags look like `1.0.0`).
- Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/). The type
  decides the SemVer bump: `feat` = minor, `fix`/`perf` = patch, `!` or a `BREAKING CHANGE:` footer =
  major, everything else = none.
- The version is **derived from the history with [git-cliff](https://git-cliff.org/)**, never chosen
  by hand (`cliff.toml`). Do not push unless asked.

### Releasing

PowerShell:

```powershell
$cliff = "orhunp/git-cliff:2.14.2"
# 1. derive the next version from commits since the last tag
$v = docker run --rm -v "${PWD}:/app" -w /app $cliff --bumped-version
git flow release start $v
# 2. changelog + package.json version (no git tag from npm)
docker run --rm -v "${PWD}:/app" -w /app $cliff --bump -o CHANGELOG.md
docker compose run --rm dev npm version $v --no-git-tag-version
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): $v"
git flow release finish $v   # tags $v on master, merges back to develop
```

If git-cliff complains about "dubious ownership", add
`-e GIT_CONFIG_PARAMETERS="'safe.directory=*'"` to the `docker run` call. The first release is
`1.0.0` (`initial_tag` in `cliff.toml`).

## License

[MIT](LICENSE) © 2026 Tundratier
