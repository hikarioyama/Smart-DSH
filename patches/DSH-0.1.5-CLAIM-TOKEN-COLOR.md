# DSH 0.1.5 claim-token color leak

## Symptom

After `/btw ` (and any other claimed slash command), the composer warn color
(`--dsw-alias-state-warn-label`, amber) stayed on the arguments, not only the
command name.

## Cause

`registerClaimDecoration` in `@deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.2`
styled the whole claim token, including the trailing separator. Typing at that
boundary inserted into the styled `TextNode`. `splitText` copied the warn color
onto the overflow, and Lexical normalized same-style siblings back together
before the overflow node's transform could clear it. That merge looped
(`endlessly triggering additional transforms`) and left the question orange.

## Live patch

File:

`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`

`registerClaimDecoration` now paints only `token.trimEnd()` and clears
`TOKEN_STYLE` on the overflow parts in the same transform.

`node --check` passes. A lexical 0.49 reproduction of the unfixed transform
throws the infinite-transform error; the patched rule keeps `/btw` amber and
the following question plain.

Reapply after a DSH upgrade with `node scripts/apply-claim-token-color.mjs`.
The script is idempotent and refuses a bundle that no longer contains the known
decoration block. HMR polls this bundle, so a browser reload is enough. Do not
restart `dsh-web.service` for this patch. An npm upgrade of `@deepseek-ai/dsh`
replaces the file and drops the patch.
