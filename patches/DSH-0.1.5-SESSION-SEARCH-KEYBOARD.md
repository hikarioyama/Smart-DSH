# DSH 0.1.5 session search keyboard

On a phone, the session-list magnifier focuses the search field. That opens the
software keyboard even when the user only wanted to see sessions.

`focusSessionSearch` skips that programmatic focus when the pointer is coarse
or the viewport is narrower than 768px. Tapping the field itself still focuses
it, so search remains available.

Selecting a session also focused the composer. On a phone that opens the
software keyboard. `phoneSkipsComposerFocus` skips that session-change focus,
and the same check stops Lexical from focusing the composer root while the
selection is reconciled. Tapping the composer still opens the keyboard.

Apply with `node scripts/apply-session-search-keyboard.mjs`.
The script is idempotent and patches both client bundles. Reload the browser
tab; do not restart `dsh-web` for this patch.
