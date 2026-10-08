/**
 * One error type for everything the user might see. `userMessage` is written for people,
 * `detail` is for the developer view. Never show raw browser/runtime errors in the UI.
 */

export type ErrorCode =
  | 'no_model'
  | 'model_unreachable'
  | 'model_auth'
  | 'model_not_found'
  | 'model_rate_limited'
  | 'model_error'
  | 'model_bad_output'
  | 'restricted_page'
  | 'blocked_site'
  | 'no_tab'
  | 'page_unreachable'
  | 'cancelled'
  | 'step_limit'
  | 'unknown';

export type RecoveryAction = 'retry' | 'open-models' | 'open-permissions' | 'open-agents';

export class AgentError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = 'AgentError';
  }
}

export const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === 'AbortError') || (err instanceof AgentError && err.code === 'cancelled');

export function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  if (isAbort(err)) return new AgentError('cancelled', 'Stopped.');
  const raw = err instanceof Error ? err.message : String(err);
  if (/Cannot access|cannot be scripted|chrome:\/\/|extensions gallery|The extensions gallery/i.test(raw)) {
    return new AgentError('restricted_page', "Chrome doesn't let extensions work on this page. Open a regular website and try again.", raw);
  }
  if (/No tab with id|Receiving end does not exist|frame.*(does not exist|was removed)|message port closed/i.test(raw)) {
    return new AgentError('page_unreachable', "I lost track of the page — it may have closed or reloaded. Try again.", raw);
  }
  return new AgentError('unknown', 'Something went wrong on my side. Please try again.', raw);
}

export function recoveryFor(code: ErrorCode): RecoveryAction[] {
  switch (code) {
    case 'no_model':
    case 'model_auth':
    case 'model_not_found':
    case 'model_unreachable':
      return ['open-models', 'retry'];
    case 'blocked_site':
      return ['open-permissions'];
    case 'restricted_page':
      return [];
    case 'cancelled':
      return ['retry'];
    default:
      return ['retry'];
  }
}

export function errorTitle(code: ErrorCode): string {
  switch (code) {
    case 'no_model':
      return 'Connect an AI model';
    case 'model_unreachable':
      return "Can't reach the AI model";
    case 'model_auth':
      return 'The model rejected the key';
    case 'model_not_found':
      return 'Model not found';
    case 'model_rate_limited':
      return 'The model is busy';
    case 'restricted_page':
      return "Can't work on this page";
    case 'blocked_site':
      return 'This site is off-limits';
    case 'step_limit':
      return 'Took too many steps';
    case 'cancelled':
      return 'Stopped';
    default:
      return "Couldn't finish that";
  }
}
