/**
 * @tessera/sdk — TesseraPort over real Solana JSON-RPC (T04).
 *
 * Public surface:
 *  - createSolanaTesseraPort: the TesseraPort contract (preview / prepare /
 *    submit / poll / getNode / getPayouts / verifyRelease / exportBranch)
 *    plus deployment helpers (connect, initializeDeployment, createProject,
 *    quoteContribution, prepareStatement/submitStatement scaffold) and the
 *    sponsor hooks (buildContributionMessage, submitSignedWire).
 *  - TransactionSigner / LocalTransactionSigner: injected signing boundary.
 *  - Instruction builders, message compile/parse, PDA derivation, account
 *    decoders and the pinned contract constants — exported so the sponsor
 *    relayer and tests exercise the SAME code paths as the port.
 *
 * Modes: 'local' (local validator), 'devnet' (test evidence), 'mainnet'
 * (read-only — writes return MAINNET_WRITES_DISABLED).
 */

export {
  createSolanaTesseraPort,
  type ConnectInfo,
  type SolanaPortConfig,
  type SolanaTesseraPort,
} from './port.js';

export {
  LocalTransactionSigner,
  pubkeyBytes,
  resolveSigner,
  type TransactionSigner,
} from './signer.js';

export {
  appendContributionIx,
  createProjectIx,
  encodeCreateProjectArgs,
  encodeIntentV1Fields,
  initializeDeploymentIx,
  publishRootIx,
  InstructionBuildError,
  type AccountMetaLike,
  type BuiltInstruction,
  type CreateProjectInput,
} from './instructions.js';

export {
  compileMessage,
  parseCompiledMessage,
  serializeTransaction,
  transactionMessageBytes,
  transactionSignatureCount,
  transactionSignatures,
  TxBuildError,
  type CompiledMessage,
  type ParsedMessage,
} from './tx.js';

export {
  decodeContributionNode,
  decodeDeploymentConfig,
  decodeProjectAccount,
  decodeStatementRecord,
  intentFromNode,
  nodeToRecordV1,
  projectToV1,
  AccountDecodeError,
  type ContributionNodeData,
  type DeploymentConfigAccount,
  type ProjectAccountData,
  type StatementRecordData,
} from './accounts.js';

export {
  createProgramAddress,
  findDeploymentConfigPda,
  findNodePda,
  findProgramAddress,
  findProjectPda,
  isOnCurve,
  MAX_SEEDS,
  MAX_SEED_BYTES,
} from './pubkey.js';

export {
  JsonRpcClient,
  RpcResponseError,
  RpcTransportError,
  type Commitment,
  type RpcAccountInfo,
  type SignatureStatus,
  type SimulateResult,
} from './rpc.js';

export {
  pollSignature,
  pollErrorResult,
  reconcileNodePda,
  type PollOptions,
  type PollOutcome,
  type PdaReconcile,
} from './reconcile.js';

export { extractCustomError, mapThrown } from './errors.js';

export { ByteReader, ByteWriter, base64ToBytes, bytesEqual, bytesToBase64 } from './bytes.js';

export * from './contract.js';
