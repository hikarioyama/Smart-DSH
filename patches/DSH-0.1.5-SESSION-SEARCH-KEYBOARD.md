# DSH 0.1.5 session search keyboard

On a phone, the session-list magnifier focuses the search field. That opens the
software keyboard even when the user only wanted to see sessions.

`focusSessionSearch` skips that programmatic focus when the pointer is coarse
or the viewport is narrower than 768px. Tapping the field itself still focuses
it, so search remains available.

Apply with `node scripts/apply-session-search-keyboard.mjs`.
The script is idempotent. Reload the browser tab; do not restart `dsh-web`
for this patch.
