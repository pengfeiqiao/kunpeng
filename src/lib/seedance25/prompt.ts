import {
  rewriteUniversalVideoPrompt,
  type RewriteUniversalVideoPromptInput,
  type VideoPromptReference,
} from '@/lib/videoPrompt/prompt';

export type Seedance25Reference = VideoPromptReference;

export type RewriteSeedance25PromptInput = RewriteUniversalVideoPromptInput;

export async function rewriteSeedance25Prompt(input: RewriteSeedance25PromptInput): Promise<string> {
  return rewriteUniversalVideoPrompt(input);
}
