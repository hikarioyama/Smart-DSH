import type { CSSProperties } from 'react'
/**
 * The panel is laid out as a second DSH composer: it inherits the composer card's
 * own maximum width instead of insetting away from the composer's resize handles.
 * Only public `--dsh-*` tokens are referenced, so an upstream layout change
 * degrades to the token defaults rather than breaking the panel.
 */
export const dockStyle: CSSProperties = {
  width: '100%',
  maxWidth: 'var(--dsh-composer-card-max-width, 720px)',
  marginLeft: 'auto',
  marginRight: 'auto',
}
