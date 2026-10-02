#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup() -> (Env, Address, ContentPublishingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ContentPublishingContract);
    let client = ContentPublishingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn end_to_end_publish_tip_subscribe_analytics() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);

    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, "Writes about Soroban"),
        &500_i128,
        &(7 * 24 * 60 * 60u64),
    );

    // free article
    let free_id = client.publish(
        &author,
        &String::from_str(&env, "Hello World"),
        &hash(&env, 1),
        &false,
    );
    assert_eq!(free_id, 1);

    // premium article
    let premium_id = client.publish(
        &author,
        &String::from_str(&env, "Premium drop"),
        &hash(&env, 2),
        &true,
    );
    assert_eq!(premium_id, 2);

    // anyone can view free
    let viewed = client.record_view(&reader, &free_id);
    assert_eq!(viewed.views, 1);

    // premium without subscription is rejected
    assert_eq!(
        client
            .try_record_view(&reader, &premium_id)
            .err()
            .unwrap()
            .unwrap(),
        Error::PremiumRequiresSubscription
    );

    // subscribe for 2 periods
    let sub = client.subscribe(&reader, &author, &2_u32);
    assert_eq!(sub.total_paid, 1000);
    assert!(sub.expires_at > env.ledger().timestamp());

    // premium view now succeeds
    let v = client.record_view(&reader, &premium_id);
    assert_eq!(v.views, 1);

    // tip the article
    client.tip(&reader, &free_id, &250_i128);

    // like the article (idempotent per reader)
    client.like(&reader, &free_id);
    assert_eq!(
        client.try_like(&reader, &free_id).err().unwrap().unwrap(),
        Error::AlreadyLiked
    );

    // analytics rolled up
    let stats = client.get_stats(&author).unwrap();
    assert_eq!(stats.article_count, 2);
    assert_eq!(stats.total_views, 2);
    assert_eq!(stats.total_likes, 1);
    assert_eq!(stats.total_tips, 250);
    assert_eq!(stats.active_subscribers, 1);
    assert_eq!(stats.lifetime_subscribers, 1);
    assert_eq!(stats.subscription_revenue, 1000);

    let subs = client.get_subscribers(&author);
    assert_eq!(subs.len(), 1);

    // latest feed includes both
    assert_eq!(client.get_latest_articles().len(), 2);
}

#[test]
fn cannot_self_tip_or_self_subscribe() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Solo"),
        &String::from_str(&env, ""),
        &100_i128,
        &86_400u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Mine"),
        &hash(&env, 9),
        &false,
    );

    assert_eq!(
        client.try_tip(&author, &id, &10).err().unwrap().unwrap(),
        Error::SelfTipForbidden
    );
    assert_eq!(
        client
            .try_subscribe(&author, &author, &1u32)
            .err()
            .unwrap()
            .unwrap(),
        Error::SelfSubscribeForbidden
    );
}

#[test]
fn admin_can_pause_and_unpause() {
    let (env, admin, client) = setup();
    let author = Address::generate(&env);

    client.set_paused(&admin, &true);
    assert!(client.is_paused());

    assert_eq!(
        client
            .try_register_author(
                &author,
                &String::from_str(&env, "x"),
                &String::from_str(&env, ""),
                &0,
                &1,
            )
            .err()
            .unwrap()
            .unwrap(),
        Error::Paused
    );

    client.set_paused(&admin, &false);
    client.register_author(
        &author,
        &String::from_str(&env, "x"),
        &String::from_str(&env, ""),
        &0,
        &1,
    );
    assert!(client.get_author(&author).is_some());
}

#[test]
fn non_admin_cannot_pause() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(
        client
            .try_set_paused(&stranger, &true)
            .err()
            .unwrap()
            .unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn duplicate_initialize_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin).err().unwrap().unwrap(),
        Error::AlreadyInitialized
    );
}

#[test]
fn subscription_extends_when_renewing_active() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &10_i128,
        &100u64,
    );
    let first = client.subscribe(&reader, &author, &1u32);
    let second = client.subscribe(&reader, &author, &1u32);
    assert_eq!(second.expires_at, first.expires_at + 100);
    assert_eq!(second.total_paid, 20);

    let stats = client.get_stats(&author).unwrap();
    // active_subscribers should not double-count the same renewal
    assert_eq!(stats.active_subscribers, 1);
    assert_eq!(stats.lifetime_subscribers, 1);
}

#[test]
fn premium_view_after_expiry_fails() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &10_i128,
        &100u64,
    );
    let id = client.publish(&author, &String::from_str(&env, "P"), &hash(&env, 7), &true);
    client.subscribe(&reader, &author, &1u32);
    client.record_view(&reader, &id);

    env.ledger().with_mut(|li| li.timestamp += 1_000);
    assert_eq!(
        client.try_record_view(&reader, &id).err().unwrap().unwrap(),
        Error::PremiumRequiresSubscription
    );
}

// ── #1365: co-creator royalty splits ────────────────────────────────────────

fn shares(env: &Env, bps: &[u32]) -> Vec<CoCreatorShare> {
    let mut out = Vec::new(env);
    for &b in bps {
        out.push_back(CoCreatorShare {
            address: Address::generate(env),
            share_bps: b,
        });
    }
    out
}

fn shares_with(env: &Env, addrs: &[Address], bps: &[u32]) -> Vec<CoCreatorShare> {
    let mut out = Vec::new(env);
    for (a, &b) in addrs.iter().zip(bps.iter()) {
        out.push_back(CoCreatorShare {
            address: a.clone(),
            share_bps: b,
        });
    }
    out
}

#[test]
fn royalty_split_six_cocreators_sums_exactly() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &100_i128,
        &86_400u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Collab"),
        &hash(&env, 20),
        &false,
    );

    // Six co-creators — the issue's >5 boundary. Uneven bps that sum to 10_000.
    let s = shares(&env, &[2_000, 2_000, 1_500, 1_500, 1_500, 1_500]);
    client.set_article_cocreators(&author, &id, &s);
    assert_eq!(client.get_article_cocreators(&id).unwrap().len(), 6);

    // 999 is not divisible by any bps — dust must land on the last share
    // and the parts must sum exactly to the tip amount.
    let split = client.preview_royalty_split(&id, &999_i128);
    assert_eq!(split.len(), 6);
    let total: i128 = split.iter().fold(0, |acc, x| acc + x);
    assert_eq!(total, 999);
    // 20% of 999 = 199.8 → 199 floor for non-last shares; last absorbs dust.
    assert_eq!(split.get(0).unwrap(), 199);
    assert_eq!(split.get(1).unwrap(), 199);
    assert_eq!(split.get(2).unwrap(), 149);
    assert_eq!(split.get(3).unwrap(), 149);
    assert_eq!(split.get(4).unwrap(), 149);
    assert_eq!(split.get(5).unwrap(), 999 - 199 - 199 - 149 - 149 - 149);
}

#[test]
fn royalty_split_large_amount_does_not_overflow() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Big"),
        &hash(&env, 21),
        &false,
    );

    // Eight co-creators; amount near i128::MAX / 10_000 so a naive
    // amount * bps would overflow a wider intermediate only if unchecked.
    let s = shares(&env, &[1_250u32; 8]);
    client.set_article_cocreators(&author, &id, &s);

    let huge: i128 = i128::MAX / 10_000 - 1;
    let split = client.preview_royalty_split(&id, &huge);
    assert_eq!(split.len(), 8);
    let total: i128 = split.iter().fold(0, |acc, x| acc.checked_add(x).unwrap());
    assert_eq!(total, huge);
    for part in split.iter() {
        assert!(part >= 0);
    }
}

#[test]
fn royalty_split_rejects_overflowing_amount() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Huge"),
        &hash(&env, 22),
        &false,
    );
    let s = shares(&env, &[5_000u32, 5_000u32]);
    client.set_article_cocreators(&author, &id, &s);

    // i128::MAX * 5_000 overflows i128 — checked math must reject, not wrap.
    assert_eq!(
        client
            .try_preview_royalty_split(&id, &i128::MAX)
            .err()
            .unwrap()
            .unwrap(),
        Error::ArithmeticError
    );
}

#[test]
fn royalty_split_rejects_shares_not_summing_to_10000() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Bad"),
        &hash(&env, 23),
        &false,
    );

    // 40% + 40% = 80% ≠ 100%
    let bad = shares(&env, &[4_000u32, 4_000u32]);
    assert_eq!(
        client
            .try_set_article_cocreators(&author, &id, &bad)
            .err()
            .unwrap()
            .unwrap(),
        Error::InvalidShare
    );

    // Over-allocation: 6_000 + 5_000 = 110%
    let over = shares(&env, &[6_000u32, 5_000u32]);
    assert_eq!(
        client
            .try_set_article_cocreators(&author, &id, &over)
            .err()
            .unwrap()
            .unwrap(),
        Error::InvalidShare
    );

    // Zero share
    let zero = shares(&env, &[0u32, 10_000u32]);
    assert_eq!(
        client
            .try_set_article_cocreators(&author, &id, &zero)
            .err()
            .unwrap()
            .unwrap(),
        Error::InvalidShare
    );
}

#[test]
fn royalty_split_rejects_duplicate_cocreators() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Dup"),
        &hash(&env, 24),
        &false,
    );

    let twin = Address::generate(&env);
    let s = shares_with(&env, &[twin.clone(), twin.clone()], &[5_000u32, 5_000u32]);
    assert_eq!(
        client
            .try_set_article_cocreators(&author, &id, &s)
            .err()
            .unwrap()
            .unwrap(),
        Error::DuplicateCoCreator
    );
}

#[test]
fn royalty_split_requires_author_auth_and_article_owner() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let stranger = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Mine"),
        &hash(&env, 25),
        &false,
    );

    let s = shares(&env, &[10_000u32]);
    assert_eq!(
        client
            .try_set_article_cocreators(&stranger, &id, &s)
            .err()
            .unwrap()
            .unwrap(),
        Error::Unauthorized
    );

    // Preview with no royalties configured
    assert_eq!(
        client
            .try_preview_royalty_split(&id, &100_i128)
            .err()
            .unwrap()
            .unwrap(),
        Error::RoyaltiesNotConfigured
    );
}

#[test]
fn royalty_split_tip_with_cocreators_updates_stats() {
    let (env, _admin, client) = setup();
    let author = Address::generate(&env);
    let reader = Address::generate(&env);
    client.register_author(
        &author,
        &String::from_str(&env, "Ada"),
        &String::from_str(&env, ""),
        &0_i128,
        &1u64,
    );
    let id = client.publish(
        &author,
        &String::from_str(&env, "Tips"),
        &hash(&env, 26),
        &false,
    );

    let s = shares(&env, &[3_000u32, 3_000u32, 4_000u32]);
    client.set_article_cocreators(&author, &id, &s);

    client.tip(&reader, &id, &1_000_i128);
    let article = client.get_article(&id).unwrap();
    assert_eq!(article.tips_collected, 1_000);
    let stats = client.get_stats(&author).unwrap();
    assert_eq!(stats.total_tips, 1_000);

    let split = client.preview_royalty_split(&id, &1_000_i128);
    assert_eq!(split.len(), 3);
    assert_eq!(split.get(0).unwrap(), 300);
    assert_eq!(split.get(1).unwrap(), 300);
    assert_eq!(split.get(2).unwrap(), 400);
}
