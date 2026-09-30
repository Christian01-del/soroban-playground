#[cfg(test)]
mod tests {
    use crate::{DecoupledStorageContract, DecoupledStorageContractClient, StorageError};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_storage_tiers_and_ttl_extension() {
        let env = Env::default();
        env.mock_all_signatures();

        let contract_id = env.register_contract(None, DecoupledStorageContract);
        let client = DecoupledStorageContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        // 1. Instance Storage Initialization
        client.initialize(&admin, &25);

        // 2. Persistent Storage (User Balance)
        client.set_balance(&user, &500);
        assert_eq!(client.get_balance(&user), 500);

        // 3. Temporary Storage (Short-lived Nonces)
        let nonce_res = client.try_consume_nonce(&user, &1001);
        assert!(nonce_res.is_ok());

        // Re-using same nonce fails (replay protection)
        let duplicate_res = client.try_consume_nonce(&user, &1001);
        assert_eq!(duplicate_res, Err(Ok(StorageError::NonceExpiredOrInvalid)));
    }
}