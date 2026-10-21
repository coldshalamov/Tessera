import {
  ByteWriter,
  DISC_CONTRIBUTION_NODE,
  DISC_DEPLOYMENT_CONFIG,
  DISC_PROJECT_ACCOUNT,
  DISC_STATEMENT_RECORD,
  TESSERA_PROGRAM_ID,
  findDeploymentConfigPda,
} from '@tessera/sdk';
import { base58AddressToBytes, base58Encode, hexToBytes } from '@tessera/types';

/**
 * A programmable JSON-RPC mock implementing the exact wire surface
 * JsonRpcClient consumes. Each method is routed to a handler; accounts are
 * kept in a map keyed by base58 address so tests can simulate state changes
 * (e.g. a node PDA appearing after a send). Not a validator — it only
 * reproduces the RPC contract faithfully enough to unit-test SDK logic.
 */

export interface MockAccount {
  data: Uint8Array;
  owner: string;
  lamports?: bigint;
  executable?: boolean;
}

export interface MockChain {
  genesisHash: string;
  blockHeight: bigint;
  blockhash: string;
  accounts: Map<string, MockAccount>;
  /** signature → recorded wire base64 + current status. */
  sent: Map<string, { wire: string; status: 'processed' | 'confirmed' | 'finalized' }>;
  simulateError?: unknown;
  sendError?: { code: number; message: string };
  sendCount: number;
}

export function newMockChain(genesisHash: string): MockChain {
  return {
    genesisHash,
    blockHeight: 100n,
    blockhash: base58Encode(new Uint8Array(32).fill(9)),
    accounts: new Map(),
    sent: new Map(),
    sendCount: 0,
  };
}

/** Standard deployment: program executable + no config (or a config account). */
export async function installProgram(
  chain: MockChain,
  opts: { deployConfig?: boolean; authority?: string } = {},
): Promise<{ configPda: string }> {
  chain.accounts.set(TESSERA_PROGRAM_ID, {
    data: new Uint8Array(8),
    owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
    executable: true,
  });
  const configPda = (await findDeploymentConfigPda(TESSERA_PROGRAM_ID)).address;
  if (opts.deployConfig) {
    chain.accounts.set(
      configPda,
      account(encodeDeploymentConfig(chain.genesisHash, opts.authority ?? randomKey()), TESSERA_PROGRAM_ID),
    );
  }
  return { configPda };
}

function account(data: Uint8Array, owner: string): MockAccount {
  return { data, owner, lamports: 2_000_000n, executable: false };
}

function randomKey(): string {
  return base58Encode(crypto.getRandomValues(new Uint8Array(32)));
}

export function fetchFor(chain: MockChain): typeof fetch {
  const impl = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const req = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params?: unknown[];
    };
    const reply = (result: unknown): Response =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { status: 200 });
    const fail = (code: number, message: string): Response =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code, message } }), {
        status: 200,
      });
    const params = (req.params ?? []) as unknown[];
    switch (req.method) {
      case 'getGenesisHash':
        return reply(chain.genesisHash);
      case 'getLatestBlockhash':
        return reply({
          context: { slot: Number(chain.blockHeight) },
          value: { blockhash: chain.blockhash, lastValidBlockHeight: Number(chain.blockHeight + 150n) },
        });
      case 'getBlockHeight':
        return reply(Number(chain.blockHeight));
      case 'getAccountInfo': {
        const [address] = params as [string, { commitment?: string }];
        const acct = chain.accounts.get(address);
        if (!acct) return reply({ context: { slot: 1 }, value: null });
        return reply({
          context: { slot: 1 },
          value: {
            data: [Buffer.from(acct.data).toString('base64'), 'base64'],
            owner: acct.owner,
            lamports: Number(acct.lamports ?? 1_000_000n),
            executable: acct.executable ?? false,
          },
        });
      }
      case 'getMinimumBalanceForRentExemption':
        return reply(5_000_000);
      case 'getBalance':
        return reply({ context: { slot: 1 }, value: 1_000_000_000 });
      case 'simulateTransaction': {
        if (chain.simulateError !== undefined) {
          return reply({
            context: { slot: 1 },
            value: { err: chain.simulateError, logs: [], unitsConsumed: 0 },
          });
        }
        return reply({
          context: { slot: 1 },
          value: { err: null, logs: ['Program log: ok'], unitsConsumed: 24_000 },
        });
      }
      case 'sendTransaction': {
        if (chain.sendError) return fail(chain.sendError.code, chain.sendError.message);
        chain.sendCount += 1;
        const tx64 = params[0] as string;
        const sig = base58Encode(crypto.getRandomValues(new Uint8Array(64)));
        chain.sent.set(sig, { wire: tx64, status: 'confirmed' });
        return reply(sig);
      }
      case 'getSignatureStatuses': {
        const sigs = params[0] as string[];
        return reply({
          context: { slot: Number(chain.blockHeight) },
          value: sigs.map((s) => {
            const rec = chain.sent.get(s);
            if (!rec) return null;
            return {
              slot: Number(chain.blockHeight),
              confirmations: rec.status === 'finalized' ? null : 1,
              confirmationStatus: rec.status,
              err: null,
            };
          }),
        });
      }
      case 'getTransaction':
        return reply(null);
      default:
        return fail(-32601, `method ${req.method} not mocked`);
    }
  };
  return impl as typeof fetch;
}

// -- account encoders (test-side writers matching the decoders' layout) ----

export function encodeDeploymentConfig(genesis: string, authority: string): Uint8Array {
  const w = new ByteWriter();
  w.push(DISC_DEPLOYMENT_CONFIG)
    .u8(1)
    .push(base58AddressToBytes(genesis)!)
    .push(base58AddressToBytes(TESSERA_PROGRAM_ID)!)
    .push(base58AddressToBytes(authority)!)
    .u8(255);
  return w.finish();
}

export interface MockProjectFields {
  genesis: string;
  creator: string;
  controller?: string | null;
  rootNode?: string | null;
  projectNonce: string;
  title: string;
  termsSha256: string;
  extensionPolicy?: number;
  bump?: number;
}

export function encodeProjectAccount(f: MockProjectFields): Uint8Array {
  const w = new ByteWriter();
  w.push(DISC_PROJECT_ACCOUNT)
    .u8(1)
    .u8(1) // residual-v1
    .u8(f.extensionPolicy ?? 1)
    .u8(f.bump ?? 254)
    .push(base58AddressToBytes(f.genesis)!)
    .push(base58AddressToBytes(TESSERA_PROGRAM_ID)!)
    .push(base58AddressToBytes(f.creator)!);
  if (f.controller) w.u8(1).push(base58AddressToBytes(f.controller)!);
  else w.u8(0);
  if (f.rootNode) w.u8(1).push(base58AddressToBytes(f.rootNode)!);
  else w.u8(0);
  w.push(hexToBytes(f.projectNonce)!)
    .str(f.title)
    .push(hexToBytes(f.termsSha256)!)
    .u64(1_000_000_000_000n)
    .u64(42n)
    .i64(1789166400n);
  return w.finish();
}

export interface MockNodeFields {
  project: string;
  contributor: string;
  intentDigest: string;
  nonce: string;
  name?: string;
  title?: string;
  artifactSha256: string;
  metadataSha256?: string | null;
  termsSha256: string;
  claimBps: number;
  economicParent?: string | null;
  references?: string[];
  depth?: number;
  nodeState?: number;
  custody?: number;
  declaredAt?: bigint;
  residualIn?: bigint;
  effective?: bigint;
  residualOut?: bigint;
  issued?: bigint;
}

export function encodeContributionNode(f: MockNodeFields): Uint8Array {
  const residualIn = f.residualIn ?? 1_000_000_000_000n;
  const effective = f.effective ?? residualIn / 4n;
  const residualOut = f.residualOut ?? residualIn - effective;
  const issued = f.issued ?? effective;
  const w = new ByteWriter();
  w.push(DISC_CONTRIBUTION_NODE)
    .u8(1)
    .u8(1)
    .u8(f.nodeState ?? 1)
    .u8(253)
    .u16(f.depth ?? 0)
    .u16(f.claimBps)
    .u8(f.custody ?? 1)
    .push(base58AddressToBytes(f.project)!);
  if (f.economicParent) w.u8(1).push(base58AddressToBytes(f.economicParent)!);
  else w.u8(0);
  w.push(base58AddressToBytes(f.contributor)!)
    .u32(f.references?.length ?? 0);
  for (const r of f.references ?? []) w.push(base58AddressToBytes(r)!);
  w.push(hexToBytes(f.nonce)!)
    .str(f.name ?? 'tester')
    .str(f.title ?? 'Test')
    .push(hexToBytes(f.intentDigest)!)
    .push(hexToBytes(f.artifactSha256)!);
  if (f.metadataSha256) w.u8(1).push(hexToBytes(f.metadataSha256)!);
  else w.u8(0);
  w.push(hexToBytes(f.termsSha256)!)
    .i64(f.declaredAt ?? 1789166400n)
    .u64(4242n)
    .i64(1789166401n)
    .u64(residualIn)
    .u64(effective)
    .u64(residualOut)
    .u64(issued)
    .u64(effective)
    .u64(issued);
  return w.finish();
}

export function encodeStatementRecordPlaceholder(): Uint8Array {
  return new ByteWriter().push(DISC_STATEMENT_RECORD).finish();
}
