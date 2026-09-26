/** Keep the composer warn color on the slash command name only. */

export const ORIGINAL = `\t\t\t\tconst token = activeToken();
\t\t\t\tconst text = node.getTextContent();
\t\t\t\tif (token === null || !text.startsWith(token)) {
\t\t\t\t\tif (node.getStyle() === TOKEN_STYLE) node.setStyle("");
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (text.length > token.length) {
\t\t\t\t\tconst [tokenNode] = node.splitText(token.length);
\t\t\t\t\tif (tokenNode !== void 0 && tokenNode.getStyle() !== TOKEN_STYLE) tokenNode.setStyle(TOKEN_STYLE);
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (node.getStyle() !== TOKEN_STYLE) node.setStyle(TOKEN_STYLE);`

export const PATCHED = `\t\t\t\tconst active = activeToken();
\t\t\t\tconst text = node.getTextContent();
\t\t\t\t// Claim tokens include the argument separator ("/btw "). Paint only
\t\t\t\t// the command name. Clear overflow style in this transform: splitText
\t\t\t\t// copies the warn color, and normalization merges same-style siblings
\t\t\t\t// before the overflow node's transform can clear it, so arguments stay
\t\t\t\t// orange and the merge can loop.
\t\t\t\tconst token = text === active?.trimEnd() ? text : active;
\t\t\t\tif (token === null || !text.startsWith(token)) {
\t\t\t\t\tif (node.getStyle() === TOKEN_STYLE) node.setStyle("");
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tconst paintLength = text.startsWith(token.trimEnd()) ? token.trimEnd().length : token.length;
\t\t\t\tif (text.length > paintLength) {
\t\t\t\t\tconst parts = node.splitText(paintLength);
\t\t\t\t\tconst tokenNode = parts[0];
\t\t\t\t\tif (tokenNode !== void 0 && tokenNode.getStyle() !== TOKEN_STYLE) tokenNode.setStyle(TOKEN_STYLE);
\t\t\t\t\tfor (let i = 1; i < parts.length; i++) {
\t\t\t\t\t\tif (parts[i].getStyle() === TOKEN_STYLE) parts[i].setStyle("");
\t\t\t\t\t}
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (node.getStyle() !== TOKEN_STYLE) node.setStyle(TOKEN_STYLE);`

export function patchClaimTokenColor(source) {
  const original = source.includes(ORIGINAL)
  const patched = source.includes(PATCHED)
  if (original && patched) throw new Error('claim decoration contains both the original and patched blocks')
  if (!original && !patched) throw new Error('claim decoration block was not found')
  if (patched) return { source, state: 'patched', changed: false }
  return { source: source.replace(ORIGINAL, PATCHED), state: 'patched', changed: true }
}
