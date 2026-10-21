import { append, MAX_DEPTH, type PortableStep, portableStep } from '@tessera/math';
import type { SelectedView } from './model.js';

export type DescendantPreview =
  | { readonly ok: false; readonly code: string; readonly message: string }
  | { readonly ok: true; readonly step: PortableStep };

/** Pure arithmetic only: never constructs an account, signature or mutable record. */
export function previewDescendant(view: SelectedView, claim: string): DescendantPreview {
  if (view.walkProblem !== null) {
    return { ok: false, code: 'INCOMPLETE_ANCESTRY', message: 'Complete ancestry is required for this comparison.' };
  }
  if (view.node.depth >= MAX_DEPTH) {
    return { ok: false, code: 'DEPTH_OUT_OF_RANGE', message: 'This version is already at the maximum contribution depth.' };
  }
  if (!/^[0-9]{1,5}$/.test(claim) || Number(claim) > 10_000) {
    return { ok: false, code: 'CLAIM_OUT_OF_RANGE', message: 'Enter a whole number from 0 to 10,000 basis points.' };
  }
  const result = append(BigInt(view.node.residual_out_units), Number(claim));
  if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
  return { ok: true, step: portableStep(result.value) };
}
