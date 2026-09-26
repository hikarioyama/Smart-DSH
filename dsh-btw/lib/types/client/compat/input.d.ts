import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { BtwController } from '../controller.js';
export declare function bindInput(input: SessionInput, controller: BtwController): () => void;
