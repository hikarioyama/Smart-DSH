import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { CommandClaim, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { BtwController } from './controller.js';
export type BtwControllerFor = (sessionId: SessionId) => BtwController;
export declare function createBtwClaim(controller: BtwController, commandToken?: string): CommandClaim;
export declare function createBtwInputSource(controllerFor: BtwControllerFor): InputTriggerSource;
