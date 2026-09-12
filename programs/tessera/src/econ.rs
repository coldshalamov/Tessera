//! residual-v1 economics — exact integer port of
//! `tools/reference_economics.py` / `packages/math/src/economics.ts`.
//!
//!   effective    = floor(residual_in * claim_bps / 10_000)   (u128 checked mul)
//!   residual_out = residual_in - effective
//!   issued       = U - residual_out
//!   payout       = effective / issued   (stored as raw numerator/denominator)
//!
//! All units are u64; the multiply is performed in u128. For an all-zero
//! issued state the stored payout is 0/0 (exposed as null / ZERO_ISSUED by
//! readers, docs/01 "Boundary rules").

use anchor_lang::prelude::*;

use crate::errors::TesseraError;
use crate::{BPS_DENOMINATOR, MAX_CLAIM_BPS, TOTAL_CAPACITY_UNITS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EconStep {
    pub residual_in: u64,
    pub claim_bps: u16,
    pub effective: u64,
    pub residual_out: u64,
    pub issued: u64,
    pub payout_numerator: u64,
    pub payout_denominator: u64,
}

pub fn residual_v1_step(residual_in: u64, claim_bps: u16) -> Result<EconStep> {
    require!(
        residual_in <= TOTAL_CAPACITY_UNITS,
        TesseraError::ResidualOutOfRange
    );
    require!(claim_bps <= MAX_CLAIM_BPS, TesseraError::ClaimOutOfRange);
    if claim_bps > 0 && residual_in == 0 {
        return err!(TesseraError::BranchCapacityExhausted);
    }
    let product = (residual_in as u128)
        .checked_mul(claim_bps as u128)
        .ok_or(TesseraError::ArithmeticOverflow)?;
    let effective = u64::try_from(product / BPS_DENOMINATOR)
        .map_err(|_| TesseraError::ArithmeticOverflow)?;
    if claim_bps > 0 && effective == 0 {
        return err!(TesseraError::ClaimRoundsToZero);
    }
    let residual_out = residual_in
        .checked_sub(effective)
        .ok_or(TesseraError::ArithmeticOverflow)?;
    let issued = TOTAL_CAPACITY_UNITS
        .checked_sub(residual_out)
        .ok_or(TesseraError::ArithmeticOverflow)?;
    Ok(EconStep {
        residual_in,
        claim_bps,
        effective,
        residual_out,
        issued,
        payout_numerator: effective,
        payout_denominator: issued,
    })
}
