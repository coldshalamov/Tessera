# State, consent, branches and authority

## Separate a proposal from an economic version

An editable application draft/offer does not reserve capacity. A signed published contribution creates its own immutable economic version extending one exact parent. Publishing B from A cannot change the payouts of A or of A's other child C. Thus arbitrary branch spam cannot dilute an existing release, although it can create abusive records that applications decline to display.

A branch is a path, not a globally mutable project cap table. A project's featured head is application discovery state; it has no retroactive economic force. There can be many valid published children. “Accepted” must say who accepted what: contributor acceptance of terms, a reviewed project's controller permission, or a producer's editorial selection are different events.

## Project account

The project defines immutable `economic_rule = residual-v1`, total capacity, default terms digest, project identifier/title, creation authority, extension policy and schema version. Initially support two policies:

`OPEN`: the seed's recorded terms permit descendants under an explicit contribution license. A child must sign acceptance of the inherited terms and its own claim. The parent author already consented through that extendable license. Open here means program append permission, not public-domain status.

`REVIEWED`: a configured controller must co-sign each new contribution. This can enforce a producer's gate, but controller approval does not make someone else's stolen contribution licensed. The controller cannot change previous weights or claim to represent every underlying copyright owner.

If implementing both policies would delay the core, implement OPEN first in local/devnet and prove the license/consent flow. REVIEWED is a separately testable instruction authorization variant, not a hidden database flag. A policy change requires a new project/versioned agreement; do not silently turn a closed collaboration into an open one.

## Node lifecycle

1. `draft`: mutable server state; neither a signed offer nor durable claim.
2. `ready_for_consent`: bytes, parent, terms and math preview frozen for review.
3. `signed`: contributor signs a domain-bound intent; terms/metadata are locally preserved.
4. `submitted` / `confirmed`: transaction status, not final proof.
5. `finalized`: immutable node state exists on target chain; projection becomes canonical.
6. `restricted` or `disputed`: app discovery/distribution annotation, never a rewrite of historical facts.

Expired unsigned/signed offers can be re-proposed. A changed claim or artifact produces a fresh intent nonce. A failed transaction can be retried using the same semantic intent and nonce. No on-chain mutation is necessary for ordinary pre-publication rejection. Public dispute/retraction statements are separate signed records referencing the original; they cannot erase it or automatically adjudicate ownership.

## Economic versus editorial acceptance

Morpheus can list proposed voice takes without committing them on-chain. When a contributor elects to publish an offer as a branch, it becomes an independent immutable version under the project extension policy. A producer later chooses a release leaf. Editorial selection does not need a smart-contract approval of every interface click; it does need an immutable release manifest that identifies exactly what is sold.

Changing the chosen take means choosing another branch or publishing a new consented descendant. Removing an ancestor's audio while retaining the inherited economic claim may be legitimate under an agreement, but must be explained in metadata. Removing their economic claim requires an explicit later negotiated model, not the deletion of an audio file.

## Terms and assent

Core state contains terms hashes; exports retain exact text. Before first publication, display the name, contribution identity, selected parent, artifact title/hash, claim, effective units, own as-is payout, extension permission and economic-base agreement. Clearly distinguish the contributor's signature from the platform's transaction sponsorship. A generic signup checkbox is not a sufficient UX substitute for a specific economically consequential approval.

The submitted agreement must state that a claimant represents having the necessary rights, grants defined use/derivative permissions where applicable, and understands normalized payouts may change on descendants. It must not promise third-party copyright is cleared by a signature. Signature and enforceability questions remain contextual. See [legal/evidence](11_LEGAL_EVIDENCE.md) and [research S29–S37](../shared/RESEARCH_SOURCES.md).

## Control changes and amendments

V1 nodes and project economic policy are immutable. Service-operator upgrades cannot reallocate a finalized node. An upgradeable pilot must disclose the actual program upgrade authority and its powers, because “immutable node interface” is weaker than immutable program code.

Do not implement unrestricted `edit_node`, `set_effective`, `delete_parent`, `move_claim`, `admin_fix_owner`, or `close_finalized_node`. A changed price is a new alternative branch, and descendant work remains associated with the old one unless its authors explicitly agree to a new version.

Do not build automatic inheritance on death, bankruptcy transfers, legal seizure or key loss. Preserve evidence and allow applications to annotate a documented legal decision. A future authority model must handle those cases transparently rather than pretending private-key possession settles all law.
