---
name: git-pr-workflow
description: >-
  Use this skill whenever creating a branch, committing, pushing changes to git,
  or opening a GitHub Pull Request (PR). Enforces switching to main, rebasing
  with origin/main, creating a fresh feature branch, and pushing with an explicit branch name.
---

# Git Branch, Rebase & PR Workflow

Follow these steps whenever preparing a branch, pushing changes, or creating a pull request:

1. **Check current branch and status**
   - Run `git status -sb` and `git branch -vv`.
2. **Switch to `main` and rebase**
   - If you are on a previous feature branch, switch to `main` and update it first:
     - `git checkout main`
     - `git pull --rebase origin main`
3. **Create a new feature branch**
   - Create a descriptive branch from the updated `main`:
     - `git checkout -b <type>/<short-description>` (e.g., `feat/...` or `fix/...`)
   - If commits were already made on the old branch, cherry-pick only the new commit(s) onto the new branch (`git cherry-pick <commit-sha>`).
4. **Push with explicit branch name**
   - Always pass the explicit branch name to `git push` (never run a bare `git push`):
     - `git push -u origin <branch-name>`
5. **Create Pull Request**
   - Create the PR targeting `main` via `gh pr create --base main --head <branch-name> --title "..." --body-file ...`.
