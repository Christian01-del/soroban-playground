# Subscription Billing

`SubscriptionBilling` implements recurring SEP-41 pull payments with explicit,
time-bounded subscriber consent. It is separate from the legacy
`subscription-manager` example, whose recurring charge path requires a direct
subscriber-authorized transfer.

## Payment flow

1. A merchant creates an immutable plan containing its payment token, amount,
   and minimum interval between charges.
2. The subscriber calls the payment token's SEP-41 `approve`, naming the
   deployed subscription contract as spender and choosing a ledger expiration.
3. The subscriber calls `subscribe` with a timestamp window and maximum cycle
   count. This records consent but does not charge immediately.
4. Any keeper calls `charge` when due. The contract invokes SEP-41
   `transfer_from` and pays the merchant directly. Only one cycle can be charged
   per interval; missed periods cannot be collected in a burst.
5. The subscriber can call `cancel` at any time, even during an emergency pause.
   Cancellation is final. Revoking the token allowance supplies an independent
   immediate stop mechanism.

Both authorization layers must permit a charge: the on-contract time/cycle
bounds and the token's amount/ledger-bounded allowance. A failed charge is
atomic and leaves the schedule unchanged.

## Operational properties

- Plan price, token, interval, merchant, and name are immutable after creation.
- Funds move directly from subscriber to merchant; the contract does not retain
  customer balances.
- Charges are permissionless for reliable keeper operation.
- Plan deactivation blocks new subscriptions but does not alter prior consent.
- Subscriber-authorized renewal can adjust end time and cycle cap, but cannot
  reactivate a cancelled subscription.
- Admin pause blocks plans, subscriptions, updates, and charging while keeping
  cancellation and reads available.
- Persistent and instance storage entries refresh their Soroban TTLs.

Run tests with:

```sh
cargo test -p subscription
```
