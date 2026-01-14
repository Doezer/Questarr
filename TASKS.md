# Operational Tasks & Hardening Log

This file tracks the ongoing hardening, maintenance, and improvement tasks for the repository.

## 🟢 Active Tasks
- [ ] Fix linting warnings (unused vars, explicit any)
- [ ] Verify IGDB cache key normalization
- [ ] Check for accessibility improvements in UI components

## 📋 Backlog
### Hardening
- [ ] Audit all `any` usages in the codebase
- [ ] Ensure all icon-only buttons have `aria-label`
- [ ] Add `aria-busy` to containers during async updates

### Performance
- [ ] Optimize initial load time
- [ ] Audit `useMemo` and `useCallback` usage in hot paths

### Security
- [ ] Review all user-input validation (Zod schemas)
- [ ] Ensure `isSafeUrl` is used for all external URL fetches

## 📜 Completed Log
*(None yet)*
