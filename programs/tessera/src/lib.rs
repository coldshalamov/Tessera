//! Tessera v1 — residual-v1 economic provenance program.
//!
//! Spec: docs/04_SOLANA_PROGRAM.md, docs/14_BINARY_LAYOUT_V1.md,
//! docs/01_ECONOMIC_MODEL.md, docs/02_STATE_AND_CONSENT.md.
//!
//! Scope of this packet (T03): `initialize_deployment`, `create_project`,
//! `publish_root`, `append_contribution` with the OPEN and REVIEWED
//! extension policies, immutable `ProjectAccount`/`ContributionNode`
//! records, on-chain IntentV1 digest recomputation, idempotent nonce
//! semantics and the full constraint surface. `publish_statement` is
//! deferred (layout committed in `StatementRecord`); no tokens, custody or
//! payout instructions exist and no instruction mutates or closes a
//! finalized record.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

pub mod econ;
pub mod errors;
pub mod intent;
pub mod state;

use econ::{residual_v1_step, EconStep};
use errors::TesseraError;
use intent::{intent_digest, validate_intent_semantics, IntentV1Fields};
use state::{ContributionNode, DeploymentConfig, ProjectAccount};

declare_id!("3fkMf7oJhVkiJF3Q7N6TzbRs16gsDFrJWXHNZcSFvytX");

// ---------------------------------------------------------------------------
// Protocol constants (docs/01, docs/14)
// ---------------------------------------------------------------------------

/// U — total residual capacity units.
pub const TOTAL_CAPACITY_UNITS: u64 = 1_000_000_000_000;
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const MAX_CLAIM_BPS: u16 = 10_000;
pub const MAX_REFERENCES: usize = 8;
pub const MAX_NAME_UTF8_BYTES: usize = 64;
pub const MAX_TITLE_UTF8_BYTES: usize = 96;
pub const MAX_PROJECT_TITLE_UTF8_BYTES: usize = 96;
/// Root depth 0; at most 1025 nodes per path (docs/04).
pub const MAX_DEPTH: u16 = 1024;

/// IntentV1 domain separator (22 ASCII bytes, no terminator).
pub const INTENT_DOMAIN: &[u8] = b"TESSERA:CONTRIBUTION:1";
pub const INTENT_FORMAT_VERSION: u8 = 1;
/// statement_code 1 = CONTRIBUTE_AND_ACCEPT_TERMS.
pub const STATEMENT_CODE_CONTRIBUTE_AND_ACCEPT_TERMS: u8 = 1;

pub const STATE_VERSION_V1: u8 = 1;
/// economic_rule id 1 = "residual-v1".
pub const RULE_RESIDUAL_V1: u8 = 1;
/// Extension policies.
pub const POLICY_OPEN: u8 = 1;
pub const POLICY_REVIEWED: u8 = 2;

// ---------------------------------------------------------------------------
// Instruction argument types
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateProjectArgs {
    /// 16-byte PDA nonce; seeds ["tessera_project", creator, nonce].
    pub project_nonce: [u8; 16],
    /// <= 96 UTF-8 bytes.
    pub title: String,
    /// Project master contribution-agreement digest.
    pub terms_sha256: [u8; 32],
    /// 1 = OPEN, 2 = REVIEWED.
    pub extension_policy: u8,
    /// Required when extension_policy == REVIEWED.
    pub controller: Option<Pubkey>,
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeDeployment<'info> {
    /// CHECK: one-time immutable config PDA. Seeds verified by constraint;
    /// the handler manually creates it or performs an idempotent compare.
    /// `mut` required: the account is allocated via CPI on first creation.
    #[account(mut, seeds = [DeploymentConfig::SEED], bump)]
    pub config: UncheckedAccount<'info>,
    /// Recorded as config.authority; confers no power in v1.
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: CreateProjectArgs)]
pub struct CreateProject<'info> {
    #[account(seeds = [DeploymentConfig::SEED], bump)]
    pub config: Account<'info, DeploymentConfig>,
    /// CHECK: manual init-or-compare; canonical PDA verified by constraint.
    /// `mut` required: the account is allocated via CPI on first creation.
    #[account(
        mut,
        seeds = [ProjectAccount::SEED, creator.key().as_ref(), args.project_nonce.as_ref()],
        bump,
    )]
    pub project: UncheckedAccount<'info>,
    pub creator: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(intent: IntentV1Fields)]
pub struct PublishRoot<'info> {
    #[account(mut)]
    pub project: Account<'info, ProjectAccount>,
    /// CHECK: manual init-or-compare; canonical PDA verified by constraint.
    /// `mut` required: the account is allocated via CPI on first creation.
    #[account(
        mut,
        seeds = [ContributionNode::SEED, project.key().as_ref(), contributor.key().as_ref(), intent.nonce.as_ref()],
        bump,
    )]
    pub node: UncheckedAccount<'info>,
    /// Must equal project.creator and intent.contributor.
    pub contributor: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(intent: IntentV1Fields)]
pub struct AppendContribution<'info> {
    pub project: Account<'info, ProjectAccount>,
    /// Economic parent: program-owned, same project, FINALIZED.
    /// Read-only — sibling appends never touch parent economic state.
    pub parent: Account<'info, ContributionNode>,
    /// CHECK: manual init-or-compare; canonical PDA verified by constraint.
    /// `mut` required: the account is allocated via CPI on first creation.
    #[account(
        mut,
        seeds = [ContributionNode::SEED, project.key().as_ref(), contributor.key().as_ref(), intent.nonce.as_ref()],
        bump,
    )]
    pub node: UncheckedAccount<'info>,
    /// Must equal intent.contributor (native signer == contributor).
    pub contributor: Signer<'info>,
    /// Required iff project.extension_policy == REVIEWED; must equal
    /// project.controller. Pass the program id (None) under OPEN.
    pub controller: Option<Signer<'info>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod tessera {
    use super::*;

    /// One-time immutable deployment configuration: commits the target
    /// cluster genesis hash (the intent `network_genesis` domain). Programs
    /// cannot read the genesis hash from a sysvar, so the reviewed value is
    /// committed here once (docs/14 "Network binding"). Re-running with the
    /// same parameters is idempotent; conflicting parameters are rejected.
    pub fn initialize_deployment(
        ctx: Context<InitializeDeployment>,
        network_genesis: [u8; 32],
    ) -> Result<()> {
        require!(
            network_genesis != [0u8; 32],
            TesseraError::InvalidGenesis
        );
        let config_ai = ctx.accounts.config.to_account_info();
        let (expected, bump) =
            Pubkey::find_program_address(&[DeploymentConfig::SEED], &crate::ID);
        require!(expected == config_ai.key(), TesseraError::InvalidPda);
        if ensure_pda_created(
            &config_ai,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &[DeploymentConfig::SEED],
            bump,
            DeploymentConfig::SPACE,
        )? {
            let rec = DeploymentConfig {
                state_version: STATE_VERSION_V1,
                network_genesis,
                program_id: crate::ID,
                authority: ctx.accounts.authority.key(),
                bump,
            };
            write_account(&config_ai, &rec)?;
            emit!(DeploymentInitialized {
                config: config_ai.key(),
                network_genesis,
                authority: rec.authority,
            });
        } else {
            let existing = read_account::<DeploymentConfig>(&config_ai)?;
            require!(
                existing.network_genesis == network_genesis
                    && existing.authority == ctx.accounts.authority.key(),
                TesseraError::DeploymentConflict
            );
        }
        Ok(())
    }

    /// Create an immutable project. The network domain is committed from the
    /// deployment config; rule, capacity and policy are fixed for v1.
    /// Re-running with the same nonce AND identical parameters is idempotent;
    /// the same nonce with different parameters is rejected.
    pub fn create_project(ctx: Context<CreateProject>, args: CreateProjectArgs) -> Result<()> {
        require!(
            args.title.len() <= MAX_PROJECT_TITLE_UTF8_BYTES,
            TesseraError::ProjectTitleOutOfRange
        );
        require!(
            args.extension_policy == POLICY_OPEN || args.extension_policy == POLICY_REVIEWED,
            TesseraError::InvalidExtensionPolicy
        );
        if args.extension_policy == POLICY_REVIEWED {
            require!(args.controller.is_some(), TesseraError::MissingController);
        }
        let project_ai = ctx.accounts.project.to_account_info();
        let creator_key = ctx.accounts.creator.key();
        let seeds: [&[u8]; 3] = [
            ProjectAccount::SEED,
            creator_key.as_ref(),
            args.project_nonce.as_ref(),
        ];
        let (expected, bump) = Pubkey::find_program_address(&seeds, &crate::ID);
        require!(expected == project_ai.key(), TesseraError::InvalidPda);
        if ensure_pda_created(
            &project_ai,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &seeds,
            bump,
            ProjectAccount::SPACE,
        )? {
            let clock = Clock::get()?;
            let rec = ProjectAccount {
                state_version: STATE_VERSION_V1,
                economic_rule: RULE_RESIDUAL_V1,
                extension_policy: args.extension_policy,
                bump,
                network_genesis: ctx.accounts.config.network_genesis,
                program_id: crate::ID,
                creator: creator_key,
                controller: args.controller,
                root_node: None,
                project_nonce: args.project_nonce,
                title: args.title.clone(),
                terms_sha256: args.terms_sha256,
                total_units: TOTAL_CAPACITY_UNITS,
                created_slot: clock.slot,
                created_unix_time: clock.unix_timestamp,
            };
            write_account(&project_ai, &rec)?;
            emit!(ProjectCreated {
                project: project_ai.key(),
                creator: creator_key,
                extension_policy: args.extension_policy,
                terms_sha256: args.terms_sha256,
            });
        } else {
            let existing = read_account::<ProjectAccount>(&project_ai)?;
            let identical = existing.state_version == STATE_VERSION_V1
                && existing.economic_rule == RULE_RESIDUAL_V1
                && existing.extension_policy == args.extension_policy
                && existing.network_genesis == ctx.accounts.config.network_genesis
                && existing.program_id == crate::ID
                && existing.creator == creator_key
                && existing.controller == args.controller
                && existing.project_nonce == args.project_nonce
                && existing.title == args.title
                && existing.terms_sha256 == args.terms_sha256;
            require!(identical, TesseraError::ProjectConflict);
        }
        Ok(())
    }

    /// Publish the unique project root (residual_in = U, depth 0).
    /// Signer must be the project creator and intent.contributor.
    pub fn publish_root(ctx: Context<PublishRoot>, intent: IntentV1Fields) -> Result<()> {
        let project = &ctx.accounts.project;
        let project_key = project.key();
        let contributor_key = ctx.accounts.contributor.key();

        check_intent_domain(&intent, project, &project_key, &contributor_key)?;
        require!(
            intent.economic_parent.is_none(),
            TesseraError::RootMustHaveNoParent
        );
        require!(
            contributor_key == project.creator,
            TesseraError::CreatorRequired
        );
        let step = residual_v1_step(TOTAL_CAPACITY_UNITS, intent.claim_bps)?;

        let node_ai = ctx.accounts.node.to_account_info();
        let created = write_or_verify_node(
            &node_ai,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &project_key,
            &contributor_key,
            &intent,
            None,
            0,
            &step,
        )?;

        let project = &mut ctx.accounts.project;
        if created {
            require!(project.root_node.is_none(), TesseraError::ProjectRootExists);
            project.root_node = Some(node_ai.key());
        } else {
            // Idempotent replay of the same intent: linkage must already be
            // consistent (set it if a healed edge ever shows it empty).
            if project.root_node.is_none() {
                project.root_node = Some(node_ai.key());
            }
            require!(
                project.root_node == Some(node_ai.key()),
                TesseraError::ProjectRootExists
            );
        }
        Ok(())
    }

    /// Append a child contribution under an existing node. Parent account is
    /// strictly read-only: children are alternative branches, not
    /// withdrawals from a shared balance (docs/04).
    pub fn append_contribution(
        ctx: Context<AppendContribution>,
        intent: IntentV1Fields,
    ) -> Result<()> {
        let project = &ctx.accounts.project;
        let parent = &ctx.accounts.parent;
        let project_key = project.key();
        let parent_key = parent.key();
        let contributor_key = ctx.accounts.contributor.key();

        check_intent_domain(&intent, project, &project_key, &contributor_key)?;
        require!(
            intent.economic_parent == Some(parent_key),
            TesseraError::ParentMismatch
        );
        require!(
            parent.project == project_key,
            TesseraError::ParentProjectMismatch
        );
        require!(
            parent.node_state == ContributionNode::STATE_FINALIZED,
            TesseraError::ParentNotAppendable
        );
        // Defense in depth: the parent's address must be the canonical node
        // PDA of its own stored (project, contributor, nonce) identity.
        let (expected_parent, _) =
            ContributionNode::find_pda(&project_key, &parent.contributor, &parent.nonce);
        require!(
            expected_parent == parent_key,
            TesseraError::ParentNotCanonicalPda
        );

        let depth = parent
            .depth
            .checked_add(1)
            .ok_or(TesseraError::ArithmeticOverflow)?;
        require!(depth <= MAX_DEPTH, TesseraError::DepthOutOfRange);

        match project.extension_policy {
            POLICY_OPEN => {}
            POLICY_REVIEWED => {
                let controller = ctx
                    .accounts
                    .controller
                    .as_ref()
                    .ok_or(TesseraError::ControllerConsentRequired)?;
                require!(
                    project.controller == Some(controller.key()),
                    TesseraError::ControllerMismatch
                );
            }
            _ => return err!(TesseraError::InvalidExtensionPolicy),
        }

        let step = residual_v1_step(parent.residual_out_units, intent.claim_bps)?;

        let node_ai = ctx.accounts.node.to_account_info();
        write_or_verify_node(
            &node_ai,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &project_key,
            &contributor_key,
            &intent,
            Some(parent_key),
            depth,
            &step,
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/// Committed-domain + signer + terms + range checks shared by both publish
/// instructions (docs/14: the program rejects intents whose domain fields
/// differ from the committed configuration).
fn check_intent_domain(
    intent: &IntentV1Fields,
    project: &ProjectAccount,
    project_key: &Pubkey,
    signer: &Pubkey,
) -> Result<()> {
    require!(
        intent.network_genesis == project.network_genesis,
        TesseraError::NetworkMismatch
    );
    require!(
        intent.program_id == crate::ID,
        TesseraError::ProgramMismatch
    );
    require!(
        intent.project_address == *project_key,
        TesseraError::ProjectMismatch
    );
    require!(
        intent.contributor == *signer,
        TesseraError::SignerMismatch
    );
    require!(
        intent.terms_sha256 == project.terms_sha256,
        TesseraError::TermsMismatch
    );
    validate_intent_semantics(intent)
}

// ---------------------------------------------------------------------------
// Manual PDA init-or-compare (idempotent nonce semantics, docs/04:
// "when a PDA already exists, compare committed intent digest and return
// the existing record or conflict, never silently accept different data")
// ---------------------------------------------------------------------------

/// Create `pda` (owned by this program, `space` bytes, rent-exempt) if it is
/// still system-owned. Returns Ok(true) when freshly created, Ok(false) when
/// it already belongs to this program (caller then compares stored content).
fn ensure_pda_created<'info>(
    pda: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    seeds: &[&[u8]],
    bump: u8,
    space: usize,
) -> Result<bool> {
    if *pda.owner == crate::ID {
        return Ok(false);
    }
    require!(
        *pda.owner == anchor_lang::solana_program::system_program::ID,
        TesseraError::AccountNotFresh
    );
    require!(pda.data_is_empty(), TesseraError::AccountNotFresh);

    let rent = Rent::get()?.minimum_balance(space);
    let deficit = rent.saturating_sub(pda.lamports());
    let bump_seed = [bump];
    let mut full_seeds: Vec<&[u8]> = seeds.to_vec();
    full_seeds.push(&bump_seed);
    let signer_seeds: &[&[&[u8]]] = &[full_seeds.as_slice()];

    if deficit > 0 {
        invoke_signed(
            &system_instruction::transfer(payer.key, pda.key, deficit),
            &[payer.clone(), pda.clone(), system_program.clone()],
            signer_seeds,
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(pda.key, space as u64),
        &[pda.clone(), system_program.clone()],
        signer_seeds,
    )?;
    invoke_signed(
        &system_instruction::assign(pda.key, &crate::ID),
        &[pda.clone(), system_program.clone()],
        signer_seeds,
    )?;
    Ok(true)
}

/// Serialize `value` (8-byte Anchor discriminator + Borsh body) into the
/// account data buffer.
fn write_account<T: AccountSerialize>(ai: &AccountInfo, value: &T) -> Result<()> {
    let mut data = ai.try_borrow_mut_data()?;
    let mut dst: &mut [u8] = &mut data;
    value.try_serialize(&mut dst)
}

/// Deserialize a program-owned account (discriminator checked).
/// Caller must have already verified `ai.owner == crate::ID`.
fn read_account<T: AccountDeserialize>(ai: &AccountInfo) -> Result<T> {
    let data = ai.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    T::try_deserialize(&mut slice)
}

/// Node PDA init-or-verify shared by publish_root and append_contribution.
/// Fresh PDA -> write the full immutable record. Existing PDA -> require the
/// stored intent_digest to equal the recomputed digest (idempotent replay);
/// a different intent under the same nonce is rejected.
fn write_or_verify_node<'info>(
    node_ai: &AccountInfo<'info>,
    payer_ai: &AccountInfo<'info>,
    system_ai: &AccountInfo<'info>,
    project_key: &Pubkey,
    contributor_key: &Pubkey,
    intent: &IntentV1Fields,
    parent_key: Option<Pubkey>,
    depth: u16,
    step: &EconStep,
) -> Result<bool> {
    let seeds = ContributionNode::seeds(project_key, contributor_key, &intent.nonce);
    let (expected, bump) = Pubkey::find_program_address(&seeds, &crate::ID);
    require!(expected == node_ai.key(), TesseraError::InvalidPda);
    let digest = intent_digest(intent);
    if ensure_pda_created(
        node_ai,
        payer_ai,
        system_ai,
        &seeds,
        bump,
        ContributionNode::SPACE,
    )? {
        let clock = Clock::get()?;
        let rec = ContributionNode {
            state_version: STATE_VERSION_V1,
            economic_rule: RULE_RESIDUAL_V1,
            node_state: ContributionNode::STATE_FINALIZED,
            bump,
            depth,
            claim_bps: intent.claim_bps,
            custody_mode: intent.custody_mode,
            project: *project_key,
            economic_parent: parent_key,
            contributor: *contributor_key,
            references: intent.references.clone(),
            nonce: intent.nonce,
            name: intent.name.clone(),
            title: intent.title.clone(),
            intent_digest: digest,
            artifact_sha256: intent.artifact_sha256,
            metadata_sha256: intent.metadata_sha256,
            terms_sha256: intent.terms_sha256,
            declared_at: intent.declared_at,
            observed_slot: clock.slot,
            observed_unix_time: clock.unix_timestamp,
            residual_in_units: step.residual_in,
            effective_units: step.effective,
            residual_out_units: step.residual_out,
            issued_total_units: step.issued,
            own_payout_numerator_units: step.payout_numerator,
            own_payout_denominator_units: step.payout_denominator,
        };
        write_account(node_ai, &rec)?;
        emit!(NodePublished {
            node: node_ai.key(),
            project: *project_key,
            parent: parent_key,
            contributor: *contributor_key,
            intent_digest: digest,
            depth,
            claim_bps: intent.claim_bps,
            effective_units: step.effective,
            residual_out_units: step.residual_out,
        });
        Ok(true)
    } else {
        let existing = read_account::<ContributionNode>(node_ai)?;
        require!(
            existing.intent_digest == digest,
            TesseraError::NonceReuseMismatch
        );
        emit!(NodeReplayed {
            node: node_ai.key(),
            intent_digest: digest,
        });
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// Events (indexer feed; children are derived, never stored in a mutable list)
// ---------------------------------------------------------------------------

#[event]
pub struct DeploymentInitialized {
    pub config: Pubkey,
    pub network_genesis: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct ProjectCreated {
    pub project: Pubkey,
    pub creator: Pubkey,
    pub extension_policy: u8,
    pub terms_sha256: [u8; 32],
}

#[event]
pub struct NodePublished {
    pub node: Pubkey,
    pub project: Pubkey,
    pub parent: Option<Pubkey>,
    pub contributor: Pubkey,
    pub intent_digest: [u8; 32],
    pub depth: u16,
    pub claim_bps: u16,
    pub effective_units: u64,
    pub residual_out_units: u64,
}

/// Emitted when a republished intent maps onto an already-existing node
/// (identical digest): the transaction succeeds without changing state.
#[event]
pub struct NodeReplayed {
    pub node: Pubkey,
    pub intent_digest: [u8; 32],
}
