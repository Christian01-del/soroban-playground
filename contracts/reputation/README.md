# Reputation aggregator

This Soroban contract combines decay-weighted activity with credentials from
independent trusted issuers. Activity is accepted only from configured reporters,
is protected against replay, and is capped per reporter/subject/epoch. Credentials
are limited to one active credential per issuer and subject, so one issuer cannot
manufacture diversity by issuing many credential types.

Scores use basis-point fixed-point arithmetic. Activity decays lazily at query or
update time, keeping storage and execution bounded. The final score applies a
confidence factor of 25% without credentials, 60% with one active issuer, 80% with
two, and 100% with three or more. Expired, revoked, or disabled-issuer credentials
do not contribute.

Administrative operations configure reporters and issuers and may pause new
writes. Subjects authorize their own registration; reporters and issuers authorize
their respective attestations. Every unbounded input has an explicit limit.
