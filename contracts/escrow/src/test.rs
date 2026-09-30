#![cfg(test)]

use crate::types::{AtomicSwapStatus, Error, EscrowStatus, MilestoneStatus};
use crate::{FreelancerEscrow, FreelancerEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, BytesN, Env, Vec,
};

fn setup() -> (Env, Address, FreelancerEscrowClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FreelancerEscrow);
    let client = FreelancerEscrowClient::new(&env, &contract_id);
    (env, contract_id, client)
}

fn make_address(env: &Env) -> Address {
    Address::generate(env)
}

fn make_amounts(env: &Env, count: u32, amount: i128) -> Vec<i128> {
    let mut amounts = Vec::new(env);
    for _ in 0..count {
        amounts.push_back(amount);
    }
    amounts
}

// ── Initialization ─────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);
    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);
    client.initialize(&admin, &200);
}

// ── Create escrow ──────────────────────────────────────────────────────────

#[test]
fn test_create_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 400_i128, 300_i128, 300_i128],
    );
    assert_eq!(id, 1);

    let escrow = client.get_escrow(&1);
    assert_eq!(escrow.total_amount, 1000);
    assert_eq!(escrow.milestone_count, 3);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.paid_amount, 0);
}

#[test]
#[should_panic]
fn test_create_escrow_amounts_mismatch_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    // Sum = 900, total = 1000 — mismatch
    client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 400_i128, 300_i128, 200_i128],
    );
}

#[test]
#[should_panic]
fn test_create_escrow_no_milestones_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    client.create_escrow(&client_addr, &freelancer, &arbiter, &1000, &vec![&env]);
}

// ── Deposit ────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_activates_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 500_i128, 500_i128],
    );
    client.deposit(&id, &client_addr);

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Active);

    // First milestone should now be InProgress
    let m1 = client.get_milestone(&id, &1);
    assert_eq!(m1.status, MilestoneStatus::InProgress);
}

#[test]
#[should_panic]
fn test_deposit_wrong_client_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let impostor = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &impostor);
}

// ── Milestone lifecycle ───────────────────────────────────────────────────

#[test]
fn test_submit_approve_release() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0); // 0 fee for simple math

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);

    client.submit_milestone(&id, &freelancer, &1);
    assert_eq!(
        client.get_milestone(&id, &1).status,
        MilestoneStatus::UnderReview
    );

    client.approve_milestone(&id, &client_addr, &1);
    assert_eq!(
        client.get_milestone(&id, &1).status,
        MilestoneStatus::Approved
    );

    let payout = client.release_payment(&id, &client_addr, &1);
    assert_eq!(payout, 1000); // no fee

    let escrow = client.get_escrow(&id);
    assert_eq!(escrow.status, EscrowStatus::Completed);
    assert_eq!(escrow.paid_amount, 1000);
}

#[test]
fn test_reject_milestone_returns_to_in_progress() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &freelancer, &1);
    client.reject_milestone(&id, &client_addr, &1);

    assert_eq!(
        client.get_milestone(&id, &1).status,
        MilestoneStatus::InProgress
    );
}

#[test]
fn test_multi_milestone_progression() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &300,
        &vec![&env, 100_i128, 100_i128, 100_i128],
    );
    client.deposit(&id, &client_addr);

    // Pay milestone 1, check milestone 2 starts
    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);
    client.release_payment(&id, &client_addr, &1);
    assert_eq!(
        client.get_milestone(&id, &2).status,
        MilestoneStatus::InProgress
    );

    // Pay milestone 2, check milestone 3 starts
    client.submit_milestone(&id, &freelancer, &2);
    client.approve_milestone(&id, &client_addr, &2);
    client.release_payment(&id, &client_addr, &2);
    assert_eq!(
        client.get_milestone(&id, &3).status,
        MilestoneStatus::InProgress
    );

    // Pay milestone 3, escrow completes
    client.submit_milestone(&id, &freelancer, &3);
    client.approve_milestone(&id, &client_addr, &3);
    client.release_payment(&id, &client_addr, &3);

    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn test_arbiter_fee_deducted() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &500); // 5%

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);

    let payout = client.release_payment(&id, &client_addr, &1);
    assert_eq!(payout, 950); // 1000 - 5%
}

// ── Submit errors ─────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_submit_milestone_wrong_freelancer_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let impostor = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &impostor, &1);
}

#[test]
#[should_panic]
fn test_submit_non_in_progress_milestone_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &200,
        &vec![&env, 100_i128, 100_i128],
    );
    client.deposit(&id, &client_addr);
    // Milestone 2 is still Pending
    client.submit_milestone(&id, &freelancer, &2);
}

// ── Dispute ───────────────────────────────────────────────────────────────

#[test]
fn test_raise_and_resolve_dispute_freelancer_favored() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);

    client.raise_dispute(&id, &client_addr);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Disputed);

    let payout = client.resolve_dispute(&id, &arbiter, &0); // FreelancerFavored
    assert_eq!(payout, 1000);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Completed);
}

#[test]
fn test_resolve_dispute_client_favored() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &freelancer);

    let payout = client.resolve_dispute(&id, &arbiter, &1); // ClientFavored
    assert_eq!(payout, 0);
}

#[test]
fn test_resolve_dispute_split() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &client_addr);

    let payout = client.resolve_dispute(&id, &arbiter, &2); // Split
    assert_eq!(payout, 500);
}

#[test]
#[should_panic]
fn test_raise_dispute_on_pending_escrow_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.raise_dispute(&id, &client_addr);
}

#[test]
#[should_panic]
fn test_resolve_dispute_wrong_arbiter_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);
    let impostor = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &client_addr);
    client.resolve_dispute(&id, &impostor, &0);
}

// ── Cancel ────────────────────────────────────────────────────────────────

#[test]
fn test_cancel_pending_escrow() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.cancel_escrow(&id, &client_addr);
    assert_eq!(client.get_escrow(&id).status, EscrowStatus::Cancelled);
}

#[test]
#[should_panic]
fn test_cancel_active_escrow_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.cancel_escrow(&id, &client_addr);
}

#[test]
#[should_panic]
fn test_create_escrow_too_many_milestones_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let amounts = make_amounts(&env, 21, 1_i128);
    client.create_escrow(&client_addr, &freelancer, &arbiter, &2100, &amounts);
}

#[test]
#[should_panic]
fn test_release_payment_without_approval_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.release_payment(&id, &client_addr, &1);
}

#[test]
#[should_panic]
fn test_approve_milestone_wrong_client_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let impostor = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &impostor, &1);
}

#[test]
#[should_panic]
fn test_resolve_dispute_invalid_ruling_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &client_addr);
    client.resolve_dispute(&id, &arbiter, &3);
}

#[test]
#[should_panic]
fn test_raise_dispute_unauthorized_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);
    let impostor = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.deposit(&id, &client_addr);
    client.raise_dispute(&id, &impostor);
}

#[test]
#[should_panic]
fn test_cancel_pending_escrow_wrong_client_fails() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &200);

    let client_addr = make_address(&env);
    let impostor = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );
    client.cancel_escrow(&id, &impostor);
}

#[test]
fn test_escrow_count_and_is_initialized() {
    let (env, _, client) = setup();
    let admin = make_address(&env);

    assert!(!client.is_initialized());
    client.initialize(&admin, &200);
    assert!(client.is_initialized());
    assert_eq!(client.get_escrow_count(), 0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 500_i128, 500_i128],
    );
    assert_eq!(client.get_escrow_count(), 1);
}

// ── Analytics ─────────────────────────────────────────────────────────────

#[test]
fn test_analytics_tracking() {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    client.initialize(&admin, &0);

    let client_addr = make_address(&env);
    let freelancer = make_address(&env);
    let arbiter = make_address(&env);

    let id = client.create_escrow(
        &client_addr,
        &freelancer,
        &arbiter,
        &1000,
        &vec![&env, 1000_i128],
    );

    let a1 = client.get_analytics();
    assert_eq!(a1.total_escrows, 1);
    assert_eq!(a1.active_escrows, 0);

    client.deposit(&id, &client_addr);
    let a2 = client.get_analytics();
    assert_eq!(a2.active_escrows, 1);
    assert_eq!(a2.total_value_locked, 1000);

    client.submit_milestone(&id, &freelancer, &1);
    client.approve_milestone(&id, &client_addr, &1);
    client.release_payment(&id, &client_addr, &1);

    let a3 = client.get_analytics();
    assert_eq!(a3.completed_escrows, 1);
    assert_eq!(a3.total_paid_out, 1000);
}

struct AtomicSetup {
    env: Env,
    client: FreelancerEscrowClient<'static>,
    maker: Address,
    taker: Address,
    stranger: Address,
    offered_token: Address,
    requested_token: Address,
    offered: TokenClient<'static>,
    requested: TokenClient<'static>,
}

fn setup_atomic() -> AtomicSetup {
    let (env, _, client) = setup();
    let admin = make_address(&env);
    let maker = make_address(&env);
    let taker = make_address(&env);
    let stranger = make_address(&env);
    client.initialize(&admin, &200);

    let offered_asset = env.register_stellar_asset_contract_v2(make_address(&env));
    let requested_asset = env.register_stellar_asset_contract_v2(make_address(&env));
    let offered_token = offered_asset.address();
    let requested_token = requested_asset.address();
    let offered = TokenClient::new(&env, &offered_token);
    let requested = TokenClient::new(&env, &requested_token);
    let offered_admin = StellarAssetClient::new(&env, &offered_token);
    let requested_admin = StellarAssetClient::new(&env, &requested_token);
    offered_admin.mint(&maker, &1_000);
    requested_admin.mint(&taker, &2_000);

    AtomicSetup {
        env,
        client,
        maker,
        taker,
        stranger,
        offered_token,
        requested_token,
        offered,
        requested,
    }
}

fn secret(env: &Env) -> (Bytes, BytesN<32>) {
    let preimage = Bytes::from_slice(env, b"correct horse battery staple");
    let computed = env.crypto().sha256(&preimage);
    (
        preimage,
        BytesN::<32>::from_array(env, &computed.to_array()),
    )
}

fn create_atomic(setup: &AtomicSetup) -> (u64, Bytes) {
    let (preimage, hashlock) = secret(&setup.env);
    let id = setup.client.create_atomic_swap(
        &setup.maker,
        &setup.taker,
        &setup.offered_token,
        &400,
        &setup.requested_token,
        &600,
        &hashlock,
        &(setup.env.ledger().timestamp() + 3_600),
    );
    (id, preimage)
}

#[test]
fn test_create_atomic_swap_custodies_maker_asset() {
    let setup = setup_atomic();
    let (id, _) = create_atomic(&setup);
    let swap = setup.client.get_atomic_swap(&id);

    assert_eq!(id, 1);
    assert_eq!(swap.status, AtomicSwapStatus::AwaitingCounterparty);
    assert_eq!(swap.offered_amount, 400);
    assert_eq!(swap.requested_amount, 600);
    assert_eq!(setup.offered.balance(&setup.maker), 600);
    assert_eq!(setup.offered.balance(&setup.client.address), 400);
    assert_eq!(setup.client.get_atomic_swap_count(), 1);
    let stats = setup.client.get_atomic_swap_stats();
    assert_eq!(stats.total, 1);
    assert_eq!(stats.active, 1);
}

#[test]
fn test_designated_taker_funds_requested_asset() {
    let setup = setup_atomic();
    let (id, _) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&id, &setup.taker);

    let swap = setup.client.get_atomic_swap(&id);
    assert_eq!(swap.status, AtomicSwapStatus::Funded);
    assert!(swap.funded_at.is_some());
    assert_eq!(setup.requested.balance(&setup.taker), 1_400);
    assert_eq!(setup.requested.balance(&setup.client.address), 600);
}

#[test]
fn test_claim_atomically_exchanges_both_assets_and_reveals_secret() {
    let setup = setup_atomic();
    let (id, preimage) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&id, &setup.taker);
    setup.client.claim_atomic_swap(&id, &preimage);

    let swap = setup.client.get_atomic_swap(&id);
    assert_eq!(swap.status, AtomicSwapStatus::Claimed);
    assert_eq!(swap.revealed_preimage, Some(preimage));
    assert_eq!(setup.offered.balance(&setup.taker), 400);
    assert_eq!(setup.requested.balance(&setup.maker), 600);
    assert_eq!(setup.offered.balance(&setup.client.address), 0);
    assert_eq!(setup.requested.balance(&setup.client.address), 0);
    let stats = setup.client.get_atomic_swap_stats();
    assert_eq!(stats.active, 0);
    assert_eq!(stats.claimed, 1);
}

#[test]
fn test_wrong_preimage_is_atomic_and_replay_is_rejected() {
    let setup = setup_atomic();
    let (id, preimage) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&id, &setup.taker);
    let wrong = Bytes::from_slice(&setup.env, b"wrong secret");
    assert_eq!(
        setup.client.try_claim_atomic_swap(&id, &wrong),
        Err(Ok(Error::InvalidPreimage))
    );
    assert_eq!(
        setup.client.get_atomic_swap(&id).status,
        AtomicSwapStatus::Funded
    );
    assert_eq!(setup.offered.balance(&setup.client.address), 400);
    assert_eq!(setup.requested.balance(&setup.client.address), 600);

    setup.client.claim_atomic_swap(&id, &preimage);
    assert_eq!(
        setup.client.try_claim_atomic_swap(&id, &preimage),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_only_designated_taker_can_fund_and_swap_must_be_funded() {
    let setup = setup_atomic();
    let (id, preimage) = create_atomic(&setup);
    assert_eq!(
        setup.client.try_fund_atomic_swap(&id, &setup.stranger),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        setup.client.try_claim_atomic_swap(&id, &preimage),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_funded_swap_refunds_both_parties_at_expiry() {
    let setup = setup_atomic();
    let (id, _) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&id, &setup.taker);
    assert_eq!(
        setup.client.try_refund_atomic_swap(&id),
        Err(Ok(Error::SwapNotExpired))
    );
    let expiry = setup.client.get_atomic_swap(&id).expires_at;
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = expiry);
    setup.client.refund_atomic_swap(&id);

    assert_eq!(setup.offered.balance(&setup.maker), 1_000);
    assert_eq!(setup.requested.balance(&setup.taker), 2_000);
    assert_eq!(
        setup.client.get_atomic_swap(&id).status,
        AtomicSwapStatus::Refunded
    );
    assert_eq!(setup.client.get_atomic_swap_stats().refunded, 1);
    assert_eq!(
        setup.client.try_refund_atomic_swap(&id),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_unfunded_swap_refunds_only_maker_after_expiry() {
    let setup = setup_atomic();
    let (id, _) = create_atomic(&setup);
    let expiry = setup.client.get_atomic_swap(&id).expires_at;
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = expiry);
    setup.client.refund_atomic_swap(&id);
    assert_eq!(setup.offered.balance(&setup.maker), 1_000);
    assert_eq!(setup.requested.balance(&setup.taker), 2_000);
}

#[test]
fn test_maker_can_cancel_only_before_counterparty_funds() {
    let setup = setup_atomic();
    let (first, _) = create_atomic(&setup);
    assert_eq!(
        setup.client.try_cancel_atomic_swap(&first, &setup.stranger),
        Err(Ok(Error::Unauthorized))
    );
    setup.client.cancel_atomic_swap(&first, &setup.maker);
    assert_eq!(setup.offered.balance(&setup.maker), 1_000);
    assert_eq!(
        setup.client.get_atomic_swap(&first).status,
        AtomicSwapStatus::Cancelled
    );

    let (second, _) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&second, &setup.taker);
    assert_eq!(
        setup.client.try_cancel_atomic_swap(&second, &setup.maker),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_atomic_swap_validates_assets_amounts_hash_and_timelock() {
    let setup = setup_atomic();
    let (_, hashlock) = secret(&setup.env);
    let valid_expiry = setup.env.ledger().timestamp() + 3_600;
    assert_eq!(
        setup.client.try_create_atomic_swap(
            &setup.maker,
            &setup.taker,
            &setup.offered_token,
            &0,
            &setup.requested_token,
            &600,
            &hashlock,
            &valid_expiry,
        ),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        setup.client.try_create_atomic_swap(
            &setup.maker,
            &setup.taker,
            &setup.offered_token,
            &400,
            &setup.offered_token,
            &600,
            &hashlock,
            &valid_expiry,
        ),
        Err(Ok(Error::SameAsset))
    );
    assert_eq!(
        setup.client.try_create_atomic_swap(
            &setup.maker,
            &setup.taker,
            &setup.offered_token,
            &400,
            &setup.requested_token,
            &600,
            &BytesN::from_array(&setup.env, &[0; 32]),
            &valid_expiry,
        ),
        Err(Ok(Error::InvalidHashlock))
    );
    assert_eq!(
        setup.client.try_create_atomic_swap(
            &setup.maker,
            &setup.taker,
            &setup.offered_token,
            &400,
            &setup.requested_token,
            &600,
            &hashlock,
            &(setup.env.ledger().timestamp() + 59),
        ),
        Err(Ok(Error::TimelockOutOfRange))
    );
}

#[test]
fn test_expired_swap_cannot_be_funded_or_claimed() {
    let setup = setup_atomic();
    let (id, preimage) = create_atomic(&setup);
    let expiry = setup.client.get_atomic_swap(&id).expires_at;
    setup
        .env
        .ledger()
        .with_mut(|ledger| ledger.timestamp = expiry);
    assert_eq!(
        setup.client.try_fund_atomic_swap(&id, &setup.taker),
        Err(Ok(Error::SwapExpired))
    );
    assert_eq!(
        setup.client.try_claim_atomic_swap(&id, &preimage),
        Err(Ok(Error::InvalidState))
    );
}

#[test]
fn test_preimage_size_is_bounded() {
    let setup = setup_atomic();
    let (id, _) = create_atomic(&setup);
    setup.client.fund_atomic_swap(&id, &setup.taker);
    let oversized = Bytes::from_slice(&setup.env, &[7u8; 65]);
    assert_eq!(
        setup.client.try_claim_atomic_swap(&id, &oversized),
        Err(Ok(Error::InvalidPreimage))
    );
}

#[test]
fn test_initialize_rejects_arbiter_fee_above_one_hundred_percent() {
    let (_env, _, client) = setup();
    let admin = Address::generate(&_env);
    assert_eq!(
        client.try_initialize(&admin, &10_001),
        Err(Ok(Error::InvalidFeeBps))
    );
}
