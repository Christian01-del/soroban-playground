#[cfg(test)]
mod tests {
    use crate::{TokenVestingContract, TokenVestingContractClient, VestingError};
    use soroban_sdk::{testutils::Address as _, token, Address, Env};

    #[test]
    fn test_linear_vesting_with_cliff_and_claims() {
        let env = Env::default();
        env.mock_all_signatures();

        let admin = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        // Setup underlying token contract
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin.clone());
        let token_client = token::Client::new(&env, &token_id);
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        // Register vesting contract
        let vesting_id = env.register_contract(None, TokenVestingContract);
        let vesting_client = TokenVestingContractClient::new(&env, &vesting_id);

        vesting_client.initialize(&admin, &token_id);

        // Mint 100,000 tokens to admin for escrow
        token_admin_client.mint(&admin, &100_000);

        let start_time = 1_000;
        let cliff_duration = 500;  // Cliff at 1,500
        let total_duration = 2_000; // End at 3,000

        // 1. Create schedule for 100,000 tokens
        vesting_client.create_schedule(
            &beneficiary,
            &100_000,
            &start_time,
            &cliff_duration,
            &total_duration,
        );

        assert_eq!(token_client.balance(&vesting_id), 100_000);

        // 2. Before cliff time (t = 1,200) -> 0 claimable
        env.ledger().set_timestamp(1_200);
        assert_eq!(vesting_client.claimable_amount(&beneficiary), 0);
        assert_eq!(
            vesting_client.try_claim(&beneficiary),
            Err(Ok(VestingError::NoTokensToClaim))
        );

        // 3. At half-way point (t = 2,000; elapsed = 1,000 / 2,000) -> 50,000 claimable
        env.ledger().set_timestamp(2_000);
        assert_eq!(vesting_client.claimable_amount(&beneficiary), 50_000);

        let claimed = vesting_client.claim(&beneficiary);
        assert_eq!(claimed, 50_000);
        assert_eq!(token_client.balance(&beneficiary), 50_000);

        // 4. At vesting end time (t = 3,000) -> Remaining 50,000 claimable
        env.ledger().set_timestamp(3_000);
        assert_eq!(vesting_client.claimable_amount(&beneficiary), 50_000);

        let remaining_claimed = vesting_client.claim(&beneficiary);
        assert_eq!(remaining_claimed, 50_000);
        assert_eq!(token_client.balance(&beneficiary), 100_000);
    }
}