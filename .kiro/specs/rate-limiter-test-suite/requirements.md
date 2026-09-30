# Requirements Document: Rate Limiter Test Suite

## Introduction

This document defines the requirements for a comprehensive test suite for the Rate Limiter feature in the Soroban Playground backend. The Rate Limiter is a critical component that protects the platform from abuse and ensures fair resource distribution across users. The test suite will cover three rate limiter implementations (standard, tiered, and notary), three rate limiting strategies (Fixed Window, Sliding Window Log, Sliding Window Counter), Redis integration with fallback modes, and API key-based tiered access control.

The test suite will ensure production readiness through property-based testing, edge case coverage, concurrency testing, and integration testing with external dependencies.

## Glossary

- **Rate_Limiter**: The middleware component that enforces request rate limits
- **Tiered_Rate_Limiter**: Rate limiter middleware with API key-based tier support (free, standard, premium, admin)
- **Notary_Rate_Limiter**: Simple in-memory rate limiter for notary endpoints (10 requests/minute)
- **Rate_Limit_Strategy**: Algorithm implementing rate limit enforcement (Fixed Window, Sliding Window Log, Sliding Window Counter)
- **Fixed_Window_Strategy**: Rate limiting strategy that uses fixed time windows
- **Sliding_Window_Log_Strategy**: Rate limiting strategy that maintains a log of timestamps
- **Sliding_Window_Counter_Strategy**: Rate limiting strategy that uses weighted counters
- **Redis_Service**: Backend service providing Redis operations with in-memory fallback
- **API_Key_Service**: Service managing API key validation and tier limits
- **Fallback_Mode**: In-memory rate limiting when Redis is unavailable
- **Tier**: Access level defining rate limit quotas (free, standard, premium, admin)
- **Window**: Time period for rate limit enforcement (minute, hour, day)
- **Request_Count**: Number of requests made within a window
- **Burst_Limit**: Maximum requests allowed in a short burst

## Requirements

### Requirement 1: Standard Rate Limiter Correctness

**User Story:** As a platform operator, I want the standard rate limiter to correctly enforce limits, so that no client can exceed their allocated requests.

#### Acceptance Criteria

1. WHEN a client makes requests below the limit, THE Rate_Limiter SHALL allow all requests
2. WHEN a client reaches the exact limit, THE Rate_Limiter SHALL allow the final request and block subsequent requests
3. WHEN a client exceeds the limit, THE Rate_Limiter SHALL return HTTP 429 with Retry-After header
4. WHEN the rate limit window expires, THE Rate_Limiter SHALL reset the counter and allow new requests
5. FOR ALL valid request counts and window sizes, incrementing the counter then waiting for window expiry SHALL restore full quota (round-trip property)
6. THE Rate_Limiter SHALL set X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers on all responses

### Requirement 2: Rate Limiting Strategy Equivalence

**User Story:** As a developer, I want all rate limiting strategies to provide equivalent protection, so that strategy choice is based on performance not correctness.

#### Acceptance Criteria

1. FOR ALL strategies (Fixed_Window, Sliding_Window_Log, Sliding_Window_Counter), enforcing a limit of N requests SHALL block the (N+1)th request
2. FOR ALL strategies, the request count SHALL never exceed the configured limit by more than 1 during concurrent requests (eventual consistency)
3. WHEN comparing Fixed_Window_Strategy and Sliding_Window_Counter_Strategy with identical limits, THE difference in allowed requests SHALL be at most 10% over multiple windows (metamorphic property)
4. FOR ALL strategies, applying rate limiting twice to the same request SHALL produce the same result as applying it once (idempotence)
5. WHEN a request is allowed by any strategy, THE Redis_Service SHALL increment the counter exactly once

### Requirement 3: Tiered Rate Limiter API Key Integration

**User Story:** As a platform operator, I want the tiered rate limiter to enforce different quotas per tier, so that premium users receive higher limits.

#### Acceptance Criteria

1. WHEN a valid API key is provided, THE Tiered_Rate_Limiter SHALL apply the tier-specific limits from the API_Key_Service
2. WHEN no API key is provided, THE Tiered_Rate_Limiter SHALL apply the fallback tier limits
3. WHEN an invalid or expired API key is provided, THE Tiered_Rate_Limiter SHALL apply the fallback tier limits
4. THE Tiered_Rate_Limiter SHALL enforce separate limits for minute, hour, and day windows simultaneously
5. WHEN any window limit is exceeded, THE Tiered_Rate_Limiter SHALL block the request with HTTP 429
6. THE Tiered_Rate_Limiter SHALL set tier-specific headers (X-RateLimit-Tier, X-RateLimit-Limit-Minute, X-RateLimit-Limit-Hour, X-RateLimit-Limit-Day)
7. WHEN a request is rate limited, THE Tiered_Rate_Limiter SHALL log an audit event via API_Key_Service

### Requirement 4: Redis Fallback Mode Resilience

**User Story:** As a platform operator, I want the rate limiter to fail open with in-memory fallback when Redis is unavailable, so that service remains available during Redis outages.

#### Acceptance Criteria

1. WHEN Redis is unavailable, THE Rate_Limiter SHALL switch to Fallback_Mode using in-memory cache
2. WHILE in Fallback_Mode, THE Rate_Limiter SHALL enforce rate limits using local LRU cache
3. WHEN Redis becomes available again, THE Rate_Limiter SHALL automatically reconnect and exit Fallback_Mode
4. IF Redis operations throw errors, THEN THE Rate_Limiter SHALL catch the error, enable Fallback_Mode, and continue processing
5. WHILE in Fallback_Mode, THE Rate_Limiter SHALL set a fallback indicator in the response metadata
6. THE Fallback_Mode rate limiting SHALL prevent memory exhaustion by capping the cache size at 5000 entries

### Requirement 5: Identifier Resolution

**User Story:** As a developer, I want the rate limiter to correctly identify clients by IP, API key, or endpoint, so that limits are enforced per the correct scope.

#### Acceptance Criteria

1. WHEN identifier is "ip", THE Rate_Limiter SHALL use req.ip or x-forwarded-for header
2. WHEN identifier is "apiKey", THE Rate_Limiter SHALL use the x-api-key header or user.apiKey
3. WHEN identifier is "endpoint", THE Rate_Limiter SHALL use the combination of IP and originalUrl
4. WHEN identifier is "apiKeyOrIp", THE Rate_Limiter SHALL prefer API key but fall back to IP
5. FOR ALL identifier types, different identifiers SHALL maintain independent rate limit counters
6. WHEN multiple requests share the same identifier, THE Rate_Limiter SHALL track them under a single counter

### Requirement 6: Concurrent Request Handling

**User Story:** As a platform operator, I want the rate limiter to handle concurrent requests correctly, so that race conditions do not allow limit bypass.

#### Acceptance Criteria

1. WHEN N concurrent requests arrive at the same time and N equals the limit, THE Rate_Limiter SHALL allow at most N+1 requests (atomic counter tolerance)
2. WHEN concurrent requests use different identifiers, THE Rate_Limiter SHALL enforce limits independently for each identifier
3. WHEN concurrent requests use the same identifier, THE Rate_Limiter SHALL serialize counter updates via Redis atomic operations
4. FOR ALL strategies, concurrent increments SHALL not corrupt the counter state
5. WHEN 100 concurrent requests hit the rate limiter, THE Rate_Limiter SHALL complete all checks within 500ms (performance requirement)

### Requirement 7: Configuration Factory Correctness

**User Story:** As a developer, I want the rateLimitMiddleware factory to load configuration correctly, so that different endpoints receive appropriate limits.

#### Acceptance Criteria

1. WHEN a valid config key is provided, THE rateLimitMiddleware factory SHALL return middleware with the corresponding limit and windowMs
2. WHEN an unknown config key is provided, THE rateLimitMiddleware factory SHALL fall back to the "global" config
3. WHEN neither the config key nor "global" config exists, THE rateLimitMiddleware factory SHALL throw an error with a descriptive message
4. WHEN options.strategyName is provided, THE rateLimitMiddleware factory SHALL use the specified strategy
5. WHEN options.identifier is provided, THE rateLimitMiddleware factory SHALL use the specified identifier type

### Requirement 8: Notary Rate Limiter Isolation

**User Story:** As a security engineer, I want the notary rate limiter to use in-memory storage isolated from other rate limiters, so that notary service availability is independent of Redis.

#### Acceptance Criteria

1. THE Notary_Rate_Limiter SHALL enforce a limit of 10 requests per minute per IP
2. THE Notary_Rate_Limiter SHALL use in-memory Map storage, not Redis
3. WHEN the 1-minute window resets, THE Notary_Rate_Limiter SHALL reset the counter to 0
4. THE Notary_Rate_Limiter SHALL set X-RateLimit-Limit and X-RateLimit-Remaining headers
5. WHEN requests exceed the limit, THE Notary_Rate_Limiter SHALL return HTTP 429 with Retry-After header
6. THE Notary_Rate_Limiter SHALL clean up expired entries to prevent memory leaks

### Requirement 9: Analytics and Logging

**User Story:** As a platform operator, I want the rate limiter to log analytics for allowed and blocked requests, so that I can monitor usage patterns and abuse.

#### Acceptance Criteria

1. WHEN a request is allowed, THE Rate_Limiter SHALL call Redis_Service.logAnalytics with status "allowed"
2. WHEN a request is blocked, THE Rate_Limiter SHALL call Redis_Service.logAnalytics with status "blocked"
3. WHEN API key is used, THE Tiered_Rate_Limiter SHALL log audit events including apiKeyId, userId, tenantId, endpoint, and tier
4. THE Analytics logging SHALL include endpoint, IP address, and status
5. IF analytics logging fails, THEN THE Rate_Limiter SHALL continue processing the request (fail open for observability)

### Requirement 10: Header Accuracy

**User Story:** As a client developer, I want accurate rate limit headers, so that I can implement proper backoff and retry logic.

#### Acceptance Criteria

1. THE X-RateLimit-Remaining header SHALL equal limit minus current count
2. THE X-RateLimit-Remaining header SHALL never be negative
3. THE X-RateLimit-Reset header SHALL contain the Unix timestamp when the current window expires
4. THE Retry-After header SHALL contain the number of seconds until the limit resets
5. FOR ALL responses (allowed and blocked), rate limit headers SHALL be present
6. WHEN in Fallback_Mode, THE Rate_Limiter SHALL still provide accurate headers based on in-memory counters

### Requirement 11: Error Handling and Resilience

**User Story:** As a platform operator, I want the rate limiter to handle errors gracefully without blocking legitimate traffic, so that service remains available during failures.

#### Acceptance Criteria

1. IF Redis_Service throws an error, THEN THE Rate_Limiter SHALL log the error and fail open (allow the request)
2. IF API_Key_Service validation fails, THEN THE Tiered_Rate_Limiter SHALL apply fallback tier limits
3. WHEN rate limit check exceeds 10ms, THE Rate_Limiter SHALL log a performance warning
4. IF strategy.check returns invalid data, THEN THE Rate_Limiter SHALL handle it gracefully and fail open
5. THE Rate_Limiter SHALL never crash the request handler due to rate limiting errors

### Requirement 12: Multi-Tenant Isolation

**User Story:** As a platform operator, I want rate limits to be enforced per tenant, so that one tenant cannot exhaust another tenant's quota.

#### Acceptance Criteria

1. WHEN API key has a tenantId, THE Tiered_Rate_Limiter SHALL include tenantId in the rate limit key
2. WHEN different tenants use the same endpoint, THE Rate_Limiter SHALL maintain separate counters per tenant
3. THE Tiered_Rate_Limiter SHALL log audit events and usage tracking with the correct tenantId
4. WHEN no tenantId is available, THE Tiered_Rate_Limiter SHALL use "public" as the default tenant

### Requirement 13: Time Window Accuracy

**User Story:** As a platform operator, I want rate limit windows to reset accurately, so that clients receive their full quota at the start of each window.

#### Acceptance Criteria

1. FOR Fixed_Window_Strategy, THE window SHALL reset exactly at the window boundary (e.g., top of the minute)
2. FOR Sliding_Window_Log_Strategy, THE window SHALL slide continuously based on timestamp comparisons
3. FOR Sliding_Window_Counter_Strategy, THE weighted calculation SHALL accurately reflect the sliding window progress
4. WHEN the current time crosses a window boundary, THE Rate_Limiter SHALL immediately allow new requests up to the limit
5. THE Rate_Limiter SHALL use consistent time sources (Date.now() or Redis server time) to avoid clock skew issues

### Requirement 14: Lua Script Correctness for Redis Operations

**User Story:** As a developer, I want Redis Lua scripts to implement rate limiting atomically, so that concurrent requests do not corrupt the rate limit state.

#### Acceptance Criteria

1. THE slidingWindowLog Lua script SHALL atomically remove expired entries, count remaining entries, and add new timestamps
2. THE slidingWindowCounter Lua script SHALL atomically read previous and current window counters and calculate the weighted sum
3. THE fixedWindow Lua script SHALL atomically increment the counter and set expiry on first increment
4. FOR ALL Lua scripts, the return value SHALL include (allowed: 0|1, current: number, retryAfter: number)
5. WHEN a Lua script rejects a request, THE retryAfter value SHALL accurately indicate when the limit resets

### Requirement 15: API Key Service Integration Testing

**User Story:** As a developer, I want integration tests between rate limiter and API key service, so that tier-based rate limiting works end-to-end.

#### Acceptance Criteria

1. WHEN a valid premium API key is used, THE Tiered_Rate_Limiter SHALL enforce premium tier limits (higher than free tier)
2. WHEN an API key expires during a session, THE Tiered_Rate_Limiter SHALL detect expiration and switch to fallback tier
3. THE Tiered_Rate_Limiter SHALL call apiKeyService.validateKey exactly once per request
4. WHEN API key validation succeeds, THE Tiered_Rate_Limiter SHALL set req.auth and req.tenant context
5. THE Tiered_Rate_Limiter SHALL call apiKeyService.trackUsage after each allowed request

### Requirement 16: Stress Testing and Performance

**User Story:** As a platform operator, I want the rate limiter to maintain performance under load, so that it does not become a bottleneck.

#### Acceptance Criteria

1. WHEN processing 1000 sequential requests, THE Rate_Limiter SHALL complete all rate limit checks within 2 seconds
2. WHEN processing 100 concurrent requests, THE Rate_Limiter SHALL not exceed 100ms for the 95th percentile latency
3. WHILE in Fallback_Mode, THE Rate_Limiter SHALL maintain performance comparable to Redis mode (within 20% latency)
4. THE Rate_Limiter SHALL not leak memory over 10,000 requests with different identifiers
5. WHEN Redis latency exceeds 10ms, THE Rate_Limiter SHALL log a performance warning

### Requirement 17: Edge Cases and Boundary Conditions

**User Story:** As a developer, I want the rate limiter to handle edge cases correctly, so that unexpected inputs do not cause failures.

#### Acceptance Criteria

1. WHEN limit is 0, THE Rate_Limiter SHALL block all requests
2. WHEN limit is 1, THE Rate_Limiter SHALL allow exactly 1 request per window
3. WHEN windowMs is very small (e.g., 100ms), THE Rate_Limiter SHALL still enforce limits correctly
4. WHEN windowMs is very large (e.g., 24 hours), THE Rate_Limiter SHALL not exhaust memory
5. WHEN identifier is empty string or undefined, THE Rate_Limiter SHALL use a fallback identifier (IP address)
6. WHEN req.ip, req.headers['x-forwarded-for'], and req.socket.remoteAddress are all undefined, THE Rate_Limiter SHALL use a default identifier like "unknown"

### Requirement 18: Backwards Compatibility

**User Story:** As a developer, I want new tests to verify backwards compatibility, so that existing rate limiter behavior is not broken.

#### Acceptance Criteria

1. THE test suite SHALL verify that existing rate limiter configurations in config/index.js continue to work
2. THE test suite SHALL verify that existing rateLimiter() and rateLimitMiddleware() APIs remain unchanged
3. THE test suite SHALL verify that existing Redis Lua scripts produce identical results with test inputs
4. WHEN tests are run against the current codebase, THE test suite SHALL pass without modifications to production code
