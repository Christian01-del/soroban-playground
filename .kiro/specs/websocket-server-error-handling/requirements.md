# Requirements Document

## Introduction

This document specifies requirements for enhancing error handling and edge-case management within the WebSocket Server of the Soroban Playground. The WebSocket Server is a critical real-time communication component that broadcasts events (invoke progress, deploy progress, compile progress, oracle events, treasury events, rate-limit analytics) and manages client connections with heartbeat monitoring. Enhanced error handling will improve system stability, provide better user feedback, ensure backwards compatibility, and follow existing project conventions.

## Glossary

- **WebSocket_Server**: The server-side WebSocket implementation that manages client connections, broadcasts events, and handles real-time communication
- **Client**: A WebSocket client connection established through the `/ws` endpoint
- **Heartbeat_Monitor**: The mechanism that sends periodic pings to clients and terminates stale connections after missed pongs
- **Event_Bus**: Internal event emitters (invokeProgressBus, deployProgressBus, compileProgressBus, oracleProofQueueService) that broadcast events to connected clients
- **Broadcast**: The act of sending a message to all connected clients
- **Stale_Connection**: A client connection that has missed MAX_MISSED_PONGS consecutive pong responses
- **Safe_Send**: The error-tolerant mechanism for sending messages to clients
- **Safe_Stringify**: The error-tolerant mechanism for JSON serialization
- **Redis_Service**: The Redis client service used for analytics data
- **Treasury_Event**: Events related to treasury proposals and voting actions
- **Oracle_Event**: Events from the shared oracle event bus
- **Rate_Limit_Analytics**: Periodic broadcasts of rate limiting statistics and top IP addresses
- **Collaboration_Event**: Events for real-time collaborative editing features (join, cursor updates, presence)

## Requirements

### Requirement 1: Connection Authentication Error Handling

**User Story:** As a system administrator, I want robust authentication error handling, so that unauthorized connections are rejected with clear feedback and legitimate connections are not disrupted.

#### Acceptance Criteria

1. WHEN a client connects with a malformed URL, THE WebSocket_Server SHALL close the connection with status code 1008 and reason "Bad Request"
2. WHERE WS_AUTH_TOKEN is configured, WHEN a client connects without a valid token, THE WebSocket_Server SHALL close the connection with status code 1008 and reason "Unauthorized"
3. WHERE WS_AUTH_TOKEN is configured, WHEN a client provides a valid token via Authorization header, THE WebSocket_Server SHALL accept the connection
4. WHERE WS_AUTH_TOKEN is configured, WHEN a client provides a valid token via query parameter, THE WebSocket_Server SHALL accept the connection
5. WHEN the WebSocket_Server closes a connection due to authentication failure, THE WebSocket_Server SHALL log the rejection reason without exposing the expected token value

### Requirement 2: Message Serialization Error Handling

**User Story:** As a developer, I want safe JSON serialization, so that circular references or non-serializable objects do not crash the server or disrupt broadcasts.

#### Acceptance Criteria

1. WHEN Safe_Stringify receives a payload with circular references, THE Safe_Stringify SHALL return null and log the serialization error
2. WHEN Safe_Stringify receives a payload that throws during JSON.stringify, THE Safe_Stringify SHALL return null and log the error message
3. WHEN Safe_Stringify successfully serializes a payload, THE Safe_Stringify SHALL return the JSON string
4. WHEN broadcast receives a non-serializable payload, THE broadcast SHALL skip sending to all clients and log the error without throwing an exception
5. WHEN broadcastTreasuryEvent receives a non-serializable payload, THE broadcastTreasuryEvent SHALL skip sending to all clients and log the error without throwing an exception

### Requirement 3: Client Send Error Handling

**User Story:** As a system operator, I want resilient message sending, so that errors from individual client connections do not affect other clients or crash the server.

#### Acceptance Criteria

1. WHEN Safe_Send attempts to send to a client in non-OPEN state, THE Safe_Send SHALL skip sending without throwing an exception
2. WHEN Safe_Send encounters a socket send error, THE Safe_Send SHALL log the error message, remove the client from the clients set, and continue execution
3. WHEN Safe_Send successfully sends a message, THE Safe_Send SHALL not log any error
4. WHEN broadcast encounters a send error for one client, THE broadcast SHALL continue sending to remaining clients
5. FOR ALL client send operations in event forwarding, THE WebSocket_Server SHALL use Safe_Send to prevent broadcast failures

### Requirement 4: Heartbeat Monitor Error Handling

**User Story:** As a system operator, I want robust heartbeat monitoring, so that stale connections are terminated reliably and ping errors do not disrupt active connections.

#### Acceptance Criteria

1. WHEN the Heartbeat_Monitor sends a ping and the client missedPongs count reaches MAX_MISSED_PONGS, THE Heartbeat_Monitor SHALL log a warning, terminate the connection, and remove the client from the clients set
2. WHEN the Heartbeat_Monitor encounters an error during socket.ping(), THE Heartbeat_Monitor SHALL log the ping error, terminate the connection, and remove the client from the clients set
3. WHEN a client responds with a pong, THE WebSocket_Server SHALL reset the client's missedPongs count to 0
4. WHEN the Heartbeat_Monitor increments missedPongs for a client, THE Heartbeat_Monitor SHALL attempt to send a ping even if previous pings failed
5. WHEN the WebSocket_Server closes, THE WebSocket_Server SHALL clear the heartbeat timer to prevent memory leaks

### Requirement 5: Event Bus Error Handling

**User Story:** As a developer, I want event forwarding to handle errors gracefully, so that errors in event handlers do not crash the server or prevent other events from being processed.

#### Acceptance Criteria

1. WHEN invokeProgressBus emits a progress event, THE WebSocket_Server SHALL forward the event as "invoke-progress" type to all clients using Safe_Send
2. WHEN deployProgressBus emits a progress event, THE WebSocket_Server SHALL forward the event as "deploy-progress" type to all clients using Safe_Send
3. WHEN compileProgressBus emits a progress event, THE WebSocket_Server SHALL forward the event as "compile-progress" type to all clients using Safe_Send
4. WHEN oracleProofQueueService emits a progress event, THE WebSocket_Server SHALL forward the event as "oracle-proof-progress" type to all clients using Safe_Send
5. WHEN sharedOracleEventBus emits an event, THE WebSocket_Server SHALL forward the event as "oracle-event" type to all clients using Safe_Send
6. WHEN an event payload fails serialization, THE forward function SHALL skip broadcasting and log the error without throwing an exception

### Requirement 6: Redis Analytics Broadcasting Error Handling

**User Story:** As a system operator, I want analytics broadcasting to handle Redis errors gracefully, so that Redis failures do not disrupt WebSocket connections or other broadcasts.

#### Acceptance Criteria

1. WHEN the analytics broadcast interval triggers and clients.size is 0, THE WebSocket_Server SHALL skip the analytics broadcast
2. WHEN the analytics broadcast interval triggers and Redis_Service is in fallback mode, THE WebSocket_Server SHALL skip the analytics broadcast
3. WHEN the analytics broadcast interval triggers and Redis_Service client is null, THE WebSocket_Server SHALL skip the analytics broadcast
4. WHEN Redis_Service operations throw an error during analytics gathering, THE WebSocket_Server SHALL log "WS Analytics Broadcast Error" with the error message and continue execution
5. WHEN analytics data is successfully gathered, THE WebSocket_Server SHALL broadcast the rate-limit-analytics message to all clients using Safe_Send
6. FOR ALL analytics broadcasts, THE WebSocket_Server SHALL include timestamp, topIps array, and stats object in the payload

### Requirement 7: Client Message Parsing Error Handling

**User Story:** As a developer, I want client message parsing to handle malformed input gracefully, so that invalid client messages do not crash the server or affect other clients.

#### Acceptance Criteria

1. WHEN a client sends a message that is not valid JSON, THE WebSocket_Server SHALL ignore the message without throwing an exception
2. WHEN a client sends a collaboration-join message, THE WebSocket_Server SHALL set socket.docId and optionally set socket.collaboratorName and socket.collaboratorColor
3. WHEN a client sends a collaboration-cursor message, THE WebSocket_Server SHALL set socket.docId and optionally update collaborator information
4. WHEN a client sends a collaboration message, THE WebSocket_Server SHALL respond with collaboration-presence message containing peer information for the same docId
5. WHEN JSON.parse throws an error on client message, THE WebSocket_Server SHALL log nothing and continue processing other messages

### Requirement 8: WebSocket Server Lifecycle Error Handling

**User Story:** As a system operator, I want proper lifecycle management, so that server errors are logged and cleanup occurs reliably during shutdown.

#### Acceptance Criteria

1. WHEN the WebSocket_Server encounters an error event, THE WebSocket_Server SHALL log "WebSocketServer error:" with the error message
2. WHEN a client socket encounters an error event, THE WebSocket_Server SHALL log "WS client error:" with the error message and remove the client from the clients set
3. WHEN a client socket closes, THE WebSocket_Server SHALL remove the client from the clients set
4. WHEN closeWebsocketServer is called, THE WebSocket_Server SHALL terminate all client connections
5. WHEN closeWebsocketServer is called, THE WebSocket_Server SHALL clear the clients set and close the wssInstance

### Requirement 9: Backwards Compatibility

**User Story:** As a platform user, I want existing WebSocket client integrations to continue working, so that the enhanced error handling does not break current functionality.

#### Acceptance Criteria

1. THE WebSocket_Server SHALL maintain the existing `/ws` endpoint path
2. THE WebSocket_Server SHALL maintain the existing message type strings ("connected", "invoke-progress", "deploy-progress", "compile-progress", "oracle-proof-progress", "oracle-event", "treasury-event", "rate-limit-analytics", "collaboration-presence")
3. THE WebSocket_Server SHALL maintain the existing authentication mechanisms (Authorization header and token query parameter)
4. THE WebSocket_Server SHALL maintain the existing HEARTBEAT_INTERVAL_MS value of 30000 milliseconds
5. THE WebSocket_Server SHALL maintain the existing MAX_MISSED_PONGS value of 2
6. THE WebSocket_Server SHALL maintain the existing status codes for connection rejection (1008 for "Bad Request" and "Unauthorized")

### Requirement 10: Error Logging Standards

**User Story:** As a system operator, I want consistent error logging, so that I can diagnose issues quickly and correlate errors across the system.

#### Acceptance Criteria

1. WHEN any WebSocket error occurs, THE WebSocket_Server SHALL log the error with a descriptive prefix ("WS send error:", "WS serialize error:", "WS client error:", "WS ping error:", "WS Analytics Broadcast Error:", "WebSocketServer error:")
2. WHEN the Heartbeat_Monitor terminates a stale connection, THE WebSocket_Server SHALL log "WS heartbeat: terminating stale connection"
3. FOR ALL error logs, THE WebSocket_Server SHALL include the error.message property
4. THE WebSocket_Server SHALL not log sensitive information (tokens, authorization headers, user credentials) in error messages
5. WHEN Safe_Send or Safe_Stringify encounters an error, THE error log SHALL use console.error for visibility

### Requirement 11: Edge Case Handling for Collaboration Features

**User Story:** As a developer using collaboration features, I want robust handling of edge cases, so that collaboration state remains consistent even with malformed or partial messages.

#### Acceptance Criteria

1. WHEN a client sends a collaboration message without a docId, THE WebSocket_Server SHALL set socket.docId to "default-doc"
2. WHEN a client sends a collaboration message without user information, THE WebSocket_Server SHALL not set socket.collaboratorName or socket.collaboratorColor
3. WHEN building the peers list for collaboration-presence, THE WebSocket_Server SHALL exclude the requesting socket from the peer list
4. WHEN building the peers list for collaboration-presence, THE WebSocket_Server SHALL filter peers by matching docId
5. WHEN a peer in the peers list lacks collaboratorName or collaboratorColor, THE WebSocket_Server SHALL use default values ("Peer N" and "#6366f1")

### Requirement 12: Memory Leak Prevention

**User Story:** As a system operator, I want proper resource cleanup, so that long-running server instances do not experience memory leaks from WebSocket connections.

#### Acceptance Criteria

1. WHEN a client connection terminates for any reason (close, error, heartbeat timeout), THE WebSocket_Server SHALL remove the client from the clients set
2. WHEN the heartbeat timer terminates a connection, THE WebSocket_Server SHALL call socket.terminate() before removing from clients set
3. WHEN the WebSocket_Server closes, THE WebSocket_Server SHALL clear the heartbeat interval timer
4. WHEN Safe_Send encounters a send error, THE Safe_Send SHALL remove the client from the clients set immediately
5. THE WebSocket_Server SHALL not maintain references to closed sockets outside the clients set
