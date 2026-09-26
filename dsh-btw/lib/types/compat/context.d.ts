import { type Message, type ToolSchema } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
export declare const BTW_REMINDER = "<system-reminder>This is a side question from the user. You must answer this question directly in a single response.\n\nIMPORTANT CONTEXT:\n- You are a separate, lightweight agent spawned to answer this one question\n- The main agent is NOT interrupted - it continues working independently in the background\n- You share the conversation context but are a completely separate instance\n- Do NOT reference being interrupted or what you were \"previously doing\" - that framing is incorrect\n\nCRITICAL CONSTRAINTS:\n- You have NO tools available - you cannot read files, run commands, search, or take any actions\n- Follow-up questions may continue this side thread; keep each answer direct\n- You can ONLY provide information based on what you already know from the conversation context\n- NEVER say things like \"Let me try...\", \"I'll now...\", \"Let me check...\", or promise to take any action\n- If you don't know the answer, say so - do not offer to look it up or investigate\n\nSimply answer the question with the information you have.</system-reminder>";
export interface BtwContextSnapshot {
    readonly parentSessionId: string;
    readonly config: LlmCallConfig;
    readonly system?: string;
    readonly tools?: ToolSchema[];
    readonly sharedMessages: Message[];
    readonly messages: Message[];
}
/** Longest prefix that does not leave an assistant tool call without its result. */
export declare function balancedMessagePrefix(messages: readonly Message[]): Message[];
export declare function wrapQuestion(question: string): string;
export declare function snapshotContext(agent: Agent, question: string, history?: readonly {
    question: string;
    answer?: string;
}[], selected?: Pick<LlmCallConfig, 'provider' | 'model' | 'reasoningEffort'>): BtwContextSnapshot;
