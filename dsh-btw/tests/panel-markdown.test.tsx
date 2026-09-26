import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

const seen: Array<{ text: string; labels: MarkdownLabels }> = []

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: (props: { children?: React.ReactNode; icon?: React.ReactNode; 'aria-label'?: string }) =>
      React.createElement('button', { 'aria-label': props['aria-label'] }, props.icon, props.children),
    Tooltip: (props: { children?: React.ReactNode }) => React.createElement('span', null, props.children),
    IconBranchOutline16: () => null,
    IconCloseOutline16: () => null,
    IconSendOutline16: () => null,
    IconStopFill16: () => null,
    MarkdownText: (props: { text: string; labels: MarkdownLabels }) => {
      seen.push(props)
      return React.createElement('div', { 'data-markdown': props.text })
    },
  }
})

const { BtwController } = await import('../src/client/controller.js')
const { BtwOverlay } = await import('../src/client/ui/panel.js')

function openPanel(answer: string | undefined, error?: string) {
  const controller = new BtwController({ rpc: { call: () => Promise.reject(new Error('unused')) } }, 'session')
  controller.open()
  controller.state.getSnapshot = () => ({
    open: true,
    busy: false,
    turns: [{
      id: 't1',
      question: 'side question',
      at: 1,
      anchorSeq: 1,
      ...(answer !== undefined ? { answer } : {}),
      ...(error !== undefined ? { error } : {}),
    }],
    question: '',
    error: null,
  })
  return renderToStaticMarkup(createElement(BtwOverlay, { controller }))
}

describe('BTW answer markdown', () => {
  it('sends completed answers to the host MarkdownText renderer', () => {
    seen.length = 0
    const html = openPanel('**bold**\n\n- item')
    expect(html).toContain('data-markdown="**bold**')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.labels).toEqual({
      code: { copyLabel: 'Copy', copiedLabel: 'Copied' },
      footnotes: 'Footnotes',
    })
    expect(openPanel('second')).toBeTruthy()
    expect(seen[0]?.labels).toBe(seen[1]?.labels)
  })

  it('keeps errors and missing results as plain text', () => {
    seen.length = 0
    expect(openPanel(undefined, '**not** markdown')).toContain('**not** markdown')
    expect(openPanel(undefined)).toContain('No completed result recorded')
    expect(seen).toHaveLength(0)
  })
})
