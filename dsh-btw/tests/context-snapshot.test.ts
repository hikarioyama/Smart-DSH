import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { balancedMessagePrefix, snapshotContext, wrapQuestion } from '../src/host/context-snapshot.js'

const user = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (content: Message['content']) => createAssistantMessage({
  content,
  source: { provider: 'mock', model: 'mock' },
})

describe('context snapshot', () => {
  it('preserves system-message updates from the 0.1.5 history without duplicating the system prompt', () => {
    const messages = [createSystemMessage('first system', 'test'), user('hello'),
      createSystemMessage('updated system', 'test'), user('active question')]
    const header = { config: { provider: 'mock', model: 'same' },
      tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }] }
    const agent = { session: { id: 'parent', requestHeader: () => header,
      deriveMessages: () => messages } } as unknown as Agent
    const snapshot = snapshotContext(agent, 'side question')
    expect(snapshot.sharedMessages).toEqual(messages)
    expect(snapshot.messages.slice(0, -1)).toEqual(messages)
    expect(snapshot).not.toHaveProperty('system')
    expect(snapshot.config).not.toBe(header.config)
    expect(snapshot.tools).not.toBe(header.tools)
    expect(messages).toHaveLength(4)
  })

  it('keeps completed tool exchanges with the new ToolCallId contract', () => {
    const id = ToolCallId('finished-call')
    const messages = [user('question'),
      assistant([{ type: 'tool-call', id, name: 'read', arguments: '{}' }]),
      createToolResultMessage({ callId: id, content: [{ type: 'text', text: 'result' }], isError: false })]
    expect(balancedMessagePrefix(messages)).toEqual(messages)
  })

  it('refuses a session with no model request header', () => {
    const agent = { session: { requestHeader: () => undefined } } as unknown as Agent
    expect(() => snapshotContext(agent, 'question')).toThrow('No model request context')
  })
  it('keeps the active user message when the main agent is busy', () => {
    const messages = [user('old'), assistant([{ type: 'text', text: 'answer' }]), user('BUSY-4821')]
    expect(balancedMessagePrefix(messages)).toEqual(messages)
  })

  it('backs off an unfinished tool-call tail', () => {
    const safe = [user('question'), assistant([{ type: 'text', text: 'answer' }]), user('next')]
    const messages = [...safe, assistant([{
      type: 'tool-call',
      id: ToolCallId('call-1'),
      name: 'bash',
      arguments: '{}',
    }])]
    expect(balancedMessagePrefix(messages)).toEqual(safe)
  })

  it('uses Claude Code compatible one-shot constraints without a persona override', () => {
    const wrapped = wrapQuestion('what is the secret?')
    expect(wrapped).toContain('The main agent is NOT interrupted')
    expect(wrapped).toContain('You have NO tools available')
    expect(wrapped).toContain('what is the secret?')
  })
})

it('honors a model switch before the next main turn, clearing the old reasoning effort', () => {
  const header = { config: { provider: 'commandcode', model: 'old-model', reasoningEffort: 'max' } }
  const agent = { session: { id: 'parent', requestHeader: () => header, deriveMessages: () => [user('main history')] } } as unknown as Agent
  const selected = { provider: 'openai-codex', model: 'gpt-6-astra' }
  const snapshot = snapshotContext(agent, 'side question', [], selected)
  expect(snapshot.config.provider).toBe('openai-codex')
  expect(snapshot.config.model).toBe('gpt-6-astra')
  expect(snapshot.config).not.toHaveProperty('reasoningEffort')
  expect(header.config).toEqual({ provider: 'commandcode', model: 'old-model', reasoningEffort: 'max' })
})
