# Repository Guidelines & Git Workflow

## Git Branching, Pushing & Pull Requests
1. **Always branch from an up-to-date `main`:**
   - Before creating a branch for new changes (or before pushing if commits were made on an old feature branch), switch to `main` and rebase against `origin/main`:
     1. `git checkout main`
     2. `git pull --rebase origin main`
     3. `git checkout -b <new-branch-name>` (and cherry-pick or rebase any new local commits onto the new branch).
2. **Always specify the branch name when pushing:**
   - Never run a bare `git push`. Always include the remote and explicit branch name:
     `git push -u origin <branch-name>`
3. **Verify before opening a PR:**
   - Run `npm test -- --run` and `npm run build` before pushing and opening a pull request with `gh pr create`.
