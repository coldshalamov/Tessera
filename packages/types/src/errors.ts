/** Validation error codes produced by the semantic validators in this package. */
export type ValidationCode =
  | 'MISSING_FIELD'
  | 'UNEXPECTED_FIELD'
  | 'INVALID_TYPE'
  | 'INVALID_FORMAT_VERSION'
  | 'INVALID_BASE58'
  | 'INVALID_HEX'
  | 'INVALID_DECIMAL'
  | 'INVALID_UTF8'
  | 'PROHIBITED_CONTROL_CHARACTER'
  | 'INVALID_ENUM'
  | 'U64_OUT_OF_RANGE'
  | 'I64_OUT_OF_RANGE'
  | 'UNITS_OUT_OF_RANGE'
  | 'CLAIM_OUT_OF_RANGE'
  | 'NAME_OUT_OF_RANGE'
  | 'TITLE_OUT_OF_RANGE'
  | 'NONCE_OUT_OF_RANGE'
  | 'REFERENCES_OUT_OF_RANGE'
  | 'DEPTH_OUT_OF_RANGE'
  | 'FIELD_OUT_OF_RANGE'
  | 'WIRE_LENGTH_MISMATCH'
  | 'CRYPTO_UNAVAILABLE';

export interface ValidationIssue {
  readonly code: ValidationCode;
  /** Dotted path to the offending field, e.g. "node_ref.node_address". */
  readonly path: string;
  readonly message: string;
}

export function issue(code: ValidationCode, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
