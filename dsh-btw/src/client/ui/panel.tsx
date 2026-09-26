import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Button, IconBranchOutline16, IconCloseOutline16, IconSendOutline16, IconStopFill16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BtwController } from '../controller.js'
import { BOOKMARK_BAR_PX, btwTopLimit, clampHeight, isPhoneViewport, transcriptHeightForTop } from './panel-bounds.js'

export interface BtwOverlayInjected {
  readonly controller: BtwController
  readonly dockStyle?: CSSProperties
  readonly openChild?: (id: string) => Promise<void>
}

/** Build one style object that may also carry CSS custom properties. */
const css = (value: Record<string, string | number>): CSSProperties => value as CSSProperties

/**
 * Surface styling copied from the DSH composer card (same tokens, radius and
 * maximum width) so the panel reads as a second DSH input rather than a custom
 * widget. Only public `--dsw-*` / `--dsh-*` tokens are used; no hashed upstream
 * CSS-module class is referenced.
 */
const card = css({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--dsw-specific-input-major, Canvas)',
  boxShadow: 'var(--dsw-elevation-soft, none)',
  borderRadius: 22,
  color: 'var(--dsw-alias-label-primary, CanvasText)',
  fontSize: 'var(--dsh-content-font-size, 14px)',
  lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
  '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l2)',
  '--dsh-scrollbar-thumb': 'var(--dsw-alias-scrollbar-bg-l2)',
  '--dsh-scrollbar-thumb-hover': 'var(--dsw-alias-scrollbar-hover-l2)',
})
const caption = css({
  color: 'var(--dsw-alias-label-secondary, GrayText)',
  fontSize: 12,
  lineHeight: '18px',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
const question = css({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: 600 })
const answer = css({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '6px 0 0' })
const storageKey = 'smart-dsh.btw.height.v1'

export { clampHeight } from './panel-bounds.js'
function initialHeight() { try { const n = Number(localStorage.getItem(storageKey)); return Number.isFinite(n) && n >= 100 ? n : 300 } catch { return 300 } }

function phoneLayout(): boolean {
  if (typeof window === 'undefined') return false
  return isPhoneViewport(window.matchMedia('(pointer: coarse)').matches, window.innerWidth)
}

function safeAreaTop(): number {
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.paddingTop = 'env(safe-area-inset-top)'
  document.body.appendChild(probe)
  const value = Number.parseFloat(getComputedStyle(probe).paddingTop)
  probe.remove()
  return Number.isFinite(value) ? value : 0
}

function visibleHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

/** Local layout only: no hashed upstream CSS selectors or document listeners. */
export function BtwOverlay({ controller, openChild, dockStyle }: BtwOverlayInjected) {
  const state = useSyncExternalStore(controller.state.subscribe, controller.state.getSnapshot)
  const [height, setHeight] = useState(initialHeight)
  const [phone, setPhone] = useState(phoneLayout)
  const transcript = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLElement>(null)
  const followTail = useRef(true)
  const limitTop = () => btwTopLimit(phoneLayout(), safeAreaTop())
  const fitCeiling = () => {
    const el = root.current
    if (!el) return
    const next = transcriptHeightForTop(el.querySelector<HTMLElement>('[data-btw-transcript]')?.offsetHeight || height, el.getBoundingClientRect().top, limitTop())
    setHeight(current => current - next > 1 ? next : current)
  }
  useEffect(() => {
    const el = transcript.current
    if (el && followTail.current) el.scrollTop = el.scrollHeight
  }, [state.turns, state.busy, state.open])
  useEffect(() => {
    if (!state.open) return
    const refit = () => {
      setPhone(phoneLayout())
      fitCeiling()
    }
    refit()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', refit)
    viewport?.addEventListener('scroll', refit)
    window.addEventListener('resize', refit)
    return () => {
      viewport?.removeEventListener('resize', refit)
      viewport?.removeEventListener('scroll', refit)
      window.removeEventListener('resize', refit)
    }
  }, [state.open, height])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [forking, setForking] = useState(false)
  const [drag, setDrag] = useState<{ y: number; height: number; max: number } | null>(null)
  const resize = (value: number, measuredMax?: number) => {
    const next = clampHeight(value, visibleHeight(), measuredMax); setHeight(next)
    try { localStorage.setItem(storageKey, String(next)) } catch { /* storage optional */ }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag) resize(drag.height + drag.y - e.clientY, drag.max) }
  if (!state.open) return null

  /** One icon button in the DSH toolbar visual family. */
  const iconButton = (label: string, icon: ReactNode, onClick: () => void, disabled = false) =>
    <Tooltip label={label} side="bottom"><Button variant="ghost" size="sm" icon={icon} aria-label={label} disabled={disabled} onClick={onClick} style={{ padding: 0, width: 28 }} /></Tooltip>

  const topLimit = phone ? `max(env(safe-area-inset-top, 0px), ${BOOKMARK_BAR_PX}px)` : '8px'
  return <section ref={root} data-smart-btw style={{ ...card, ...dockStyle, maxHeight: `calc(100svh - ${topLimit} - 160px)` }} role="dialog" aria-label="BTW side thread" aria-modal="false"
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); controller.dismiss() } }}>
    <div role="separator" aria-label="Resize BTW" aria-orientation="horizontal" tabIndex={0}
      style={{ height: 14, flex: 'none', cursor: 'ns-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const panelTop = root.current?.getBoundingClientRect().top ?? limitTop()
        setDrag({ y: e.clientY, height, max: transcriptHeightForTop(height, panelTop, limitTop()) })
      }}
      onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}
      onKeyDown={e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const panelTop = root.current?.getBoundingClientRect().top ?? limitTop()
        resize(height + (e.key === 'ArrowUp' ? 30 : -30), transcriptHeightForTop(height, panelTop, limitTop()))
      }}>
      <span aria-hidden style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--dsw-alias-border-l2, #8884)' }} />
    </div>
    <header style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 12px 4px', flex: 'none' }}>
      <strong style={{ flex: 'none' }}>/btw</strong>
      <span style={caption}>Main task continues · audit saved separately</span>
      <span style={{ flex: 1 }} />
      {state.busy && iconButton('Cancel BTW', <IconStopFill16 />, () => controller.cancel())}
      {iconButton('Close', <IconCloseOutline16 />, () => controller.dismiss())}
    </header>
    <div data-btw-transcript ref={transcript} onScroll={e => { const el = e.currentTarget; followTail.current = el.scrollHeight - el.clientHeight - el.scrollTop < 64 }}
      style={{ overflow: 'auto', minHeight: 0, height, maxHeight: phone ? '100%' : '70dvh', overscrollBehavior: 'contain', padding: '4px 16px 8px' }}>
      {state.turns.map(t => <article key={t.id} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--dsw-alias-border-l1, #8883)' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <div style={{ ...question, flex: 1, minWidth: 0 }}>{t.question}</div>
          {t.answer !== undefined && <Tooltip side="bottom" label={t.anchorSeq === null
            ? 'Fork needs a completed parent turn'
            : 'Branch into a new conversation'}>
            <Button variant="ghost" size="sm" icon={<IconBranchOutline16 />} aria-label="Branch into a new conversation"
              aria-disabled={forking || state.busy || t.anchorSeq === null || undefined}
              disabled={forking || state.busy || t.anchorSeq === null} style={{ flex: 'none', padding: 0, width: 28 }}
              onClick={() => { setForking(true); setError(''); void controller.fork(t.id).then(async id => {
                if (openChild) await openChild(id); else setError(`Fork created: ${id}`)
              }).catch(e => setError(String(e))).finally(() => setForking(false)) }} />
          </Tooltip>}
        </div>
        <div style={answer}>{t.answer ?? t.error ?? 'No completed result recorded (pending or interrupted)'}</div>
      </article>)}
      {state.busy && <div role="status" style={{ ...caption, whiteSpace: 'pre-wrap' }}>{state.question}{'\n'}Answering independently…</div>}
    </div>
    <form style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '8px 12px 12px', flex: 'none' }}
      onSubmit={e => { e.preventDefault(); void controller.ask(draft).then(r => {
        if (r.kind === 'success') setDraft(''); else setError(r.text)
      }) }}>
      <textarea aria-label="BTW follow-up" value={draft} onChange={e => setDraft(e.target.value)} rows={1}
        placeholder="Ask a side question"
        style={{ flex: 1, minWidth: 0, maxHeight: 160, resize: 'none', font: 'inherit', lineHeight: 'inherit', color: 'inherit', background: 'transparent', border: 0, outline: 'none', padding: '7px 0' }} />
      <Tooltip label="Ask BTW" side="bottom">
        <Button variant="primary" size="md" type="submit" icon={<IconSendOutline16 />} aria-label="Ask BTW"
          disabled={state.busy || !draft.trim()} style={{ flex: 'none', width: 36, padding: 0, borderRadius: 18 }} />
      </Tooltip>
    </form>
    {(error || state.error) && <div role="alert" style={{ padding: '0 16px 12px', color: 'var(--dsw-alias-label-warning, inherit)', overflowWrap: 'anywhere' }}>{error || state.error}</div>}
  </section>
}
