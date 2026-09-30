# Requirements Document

## Introduction

This document defines requirements for refactoring the Analytics Engine, which is currently embedded within the Redis service module. The refactored Analytics Engine will be a dedicated, maintainable service responsible for tracking API usage metrics including endpoint access patterns, IP addresses, and request outcomes. The refactoring aims to improve code organization, testability, and maintainability while preserving all existing functionality and ensuring backwards compatibility.

## Glossary

- **Analytics_Engine**: The dedicated service module responsible for logging and retrieving usage metrics
- **Redis_Service**: The existing Redis client wrapper service that currently contains analytics functionality
- **Fallback_Store**: An in-memory data structure used when Redis is unavailable
- **Endpoint_Metric**: A counter tracking request counts for a specific API endpoint
- **IP_Metric**: A counter tracking request counts for a specific IP address
- **Hourly_Metric**: A counter tracking aggregated request counts for a specific hour
- **Status_Label**: A categorical value indicating the outcome of a request (e.g., 'allowed', 'blocked', 'success', 'error')
- **Analytics_Key**: A Redis key formatted according to analytics naming conventions
- **TTL**: Time-to-live in seconds for analytics data stored in Redis
- **Rate_Limiter**: The middleware component that currently invokes analytics logging

## Requirements

### Requirement 1: Extract Analytics Service

**User Story:** As a backend developer, I want analytics functionality separated from the Redis service, so that the codebase follows single-responsibility principles and is easier to maintain.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL be implemented as a separate service module in backend/src/services/analyticsService.js
2. THE Analytics_Engine SHALL export a logAnalytics method that accepts endpoint, IP address, and status label parameters
3. THE Analytics_Engine SHALL export a getSnapshot method that returns the current in-memory analytics state
4. THE Analytics_Engine SHALL maintain backward-compatible method signatures with the existing redisService analytics methods
5. THE Redis_Service SHALL delegate analytics operations to the Analytics_Engine

### Requirement 2: Preserve Dual-Mode Operation

**User Story:** As a system administrator, I want the Analytics Engine to work both with Redis and in-memory fallback mode, so that analytics continue functioning when Redis is unavailable.

#### Acceptance Criteria

1. WHEN Redis is available, THE Analytics_Engine SHALL store metrics in Redis using pipeline operations
2. WHEN Redis is unavailable, THE Analytics_Engine SHALL store metrics in the Fallback_Store
3. THE Analytics_Engine SHALL accept a storage backend reference during initialization
4. THE Analytics_Engine SHALL automatically detect storage backend availability and select the appropriate storage mode
5. WHEN storing to Redis, THE Analytics_Engine SHALL use TTL values of 30 days for all analytics keys

### Requirement 3: Maintain Analytics Key Format

**User Story:** As a data analyst, I want analytics keys to remain unchanged, so that existing dashboards and queries continue to work.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL generate hourly analytics keys in the format "analytics:hr:YYYY-MM-DD:HH" using UTC timestamps
2. THE Analytics_Engine SHALL generate endpoint analytics keys in the format "analytics:endpoint:<endpoint_name>"
3. THE Analytics_Engine SHALL generate IP analytics keys in the format "analytics:ip:<ip_address>"
4. THE Analytics_Engine SHALL pad date components with leading zeros to maintain fixed-width formatting
5. THE Analytics_Engine SHALL use the existing getAnalyticsHourKey function or an equivalent implementation

### Requirement 4: Normalize Input Values

**User Story:** As a backend developer, I want invalid or missing analytics inputs to be normalized, so that the system handles edge cases gracefully.

#### Acceptance Criteria

1. WHEN an endpoint parameter is null, undefined, or empty string, THE Analytics_Engine SHALL normalize it to "unknown"
2. WHEN an IP parameter is null, undefined, or empty string, THE Analytics_Engine SHALL normalize it to "unknown"
3. WHEN a status parameter is null, undefined, or empty string, THE Analytics_Engine SHALL normalize it to "unknown"
4. THE Analytics_Engine SHALL trim whitespace from all string parameters before storage
5. THE Analytics_Engine SHALL truncate endpoint, IP, and status values to 300 characters maximum

### Requirement 5: Track Multiple Metric Dimensions

**User Story:** As a system operator, I want analytics to track multiple dimensions simultaneously, so that I can analyze usage patterns from different perspectives.

#### Acceptance Criteria

1. WHEN logging analytics, THE Analytics_Engine SHALL increment the hourly counter for the current UTC hour
2. WHEN logging analytics, THE Analytics_Engine SHALL increment the endpoint-specific counter
3. WHEN logging analytics, THE Analytics_Engine SHALL increment the IP-specific counter
4. WHEN storing to Redis, THE Analytics_Engine SHALL increment the top IPs sorted set with the IP address
5. THE Analytics_Engine SHALL associate each counter with the provided Status_Label

### Requirement 6: Implement In-Memory Fallback Storage

**User Story:** As a backend developer, I want a memory-based fallback for analytics, so that metrics continue to be collected when Redis is down.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL maintain three Map data structures for hourly, endpoint, and IP metrics in the Fallback_Store
2. WHEN incrementing a counter in the Fallback_Store, THE Analytics_Engine SHALL create the entry if it does not exist
3. WHEN incrementing a counter in the Fallback_Store, THE Analytics_Engine SHALL increment the status-specific subkey
4. THE Analytics_Engine SHALL provide a method to retrieve a snapshot of all in-memory metrics
5. THE Analytics_Engine SHALL return metrics as plain JavaScript objects with endpoint, IP, and hourly properties

### Requirement 7: Maintain Test Coverage

**User Story:** As a QA engineer, I want existing analytics tests to continue passing, so that refactoring does not introduce regressions.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL pass all existing test cases in backend/tests/analyticsService.test.js
2. WHEN executing the test "formats hourly analytics keys with calendar-safe UTC values", THE Analytics_Engine SHALL generate the key "analytics:hr:2026-01-02:03" for timestamp "2026-01-02T03:04:05Z"
3. WHEN executing the test "records analytics in memory when Redis is unavailable", THE Analytics_Engine SHALL store metrics in memory and return stored location as "memory"
4. WHEN executing the test "normalizes missing analytics dimensions", THE Analytics_Engine SHALL convert empty or null values to "unknown"
5. THE Analytics_Engine SHALL maintain compatibility with the test suite's API expectations

### Requirement 8: Preserve Rate Limiter Integration

**User Story:** As a backend developer, I want the rate limiter middleware to continue logging analytics, so that endpoint usage tracking remains operational.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL invoke the Analytics_Engine's logAnalytics method when a request is allowed
2. THE Rate_Limiter SHALL invoke the Analytics_Engine's logAnalytics method when a request is blocked
3. THE Rate_Limiter SHALL pass the request URL, identifier, and status label to the Analytics_Engine
4. THE Analytics_Engine SHALL accept the same parameter format that the Rate_Limiter currently provides
5. WHEN the Rate_Limiter integration is complete, THE system SHALL log both "allowed" and "blocked" events to analytics

### Requirement 9: Handle Storage Errors Gracefully

**User Story:** As a system administrator, I want analytics failures to be logged but not crash the application, so that analytics issues do not impact core functionality.

#### Acceptance Criteria

1. WHEN a Redis storage operation fails, THE Analytics_Engine SHALL log an error message
2. WHEN a Redis storage operation fails, THE Analytics_Engine SHALL fallback to in-memory storage
3. WHEN a Redis storage operation fails, THE Analytics_Engine SHALL return metadata indicating storage location as "memory"
4. THE Analytics_Engine SHALL NOT throw exceptions that propagate to calling code
5. WHEN returning from logAnalytics, THE Analytics_Engine SHALL include hourKey, endpointKey, and ipKey in the response metadata

### Requirement 10: Support Batch Operations

**User Story:** As a backend developer, I want analytics to use Redis pipelines, so that multiple metrics can be stored efficiently in a single round-trip.

#### Acceptance Criteria

1. WHEN storing to Redis, THE Analytics_Engine SHALL use a pipeline to batch all operations
2. THE Analytics_Engine SHALL include hincrby operations for hourly, endpoint, and IP counters in the pipeline
3. THE Analytics_Engine SHALL include a zincrby operation for the top IPs sorted set in the pipeline
4. THE Analytics_Engine SHALL include expire operations for all analytics keys in the pipeline
5. THE Analytics_Engine SHALL execute the pipeline atomically before returning from logAnalytics

### Requirement 11: Maintain Module Export Compatibility

**User Story:** As a backend developer, I want the Analytics Engine to export both default and named instances, so that existing import statements continue to work.

#### Acceptance Criteria

1. THE Analytics_Engine module SHALL export a default instance
2. THE Analytics_Engine module SHALL export a named instance using ES6 export syntax
3. THE Analytics_Engine module SHALL be importable using "import analyticsService from './analyticsService.js'" syntax
4. THE Analytics_Engine module SHALL be importable using "import { analyticsService } from './analyticsService.js'" syntax
5. THE Analytics_Engine SHALL support both import patterns used throughout the codebase

### Requirement 12: Document Public API

**User Story:** As a new developer, I want the Analytics Engine API to be documented, so that I can understand how to use it correctly.

#### Acceptance Criteria

1. THE Analytics_Engine SHALL include JSDoc comments for the logAnalytics method describing parameters and return value
2. THE Analytics_Engine SHALL include JSDoc comments for the getSnapshot method describing the returned data structure
3. THE Analytics_Engine SHALL include inline comments explaining the normalization logic
4. THE Analytics_Engine SHALL include inline comments explaining the dual-mode storage strategy
5. THE Analytics_Engine SHALL follow the JSDoc style used in the existing redisService.js file
