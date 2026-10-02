# Account Abstraction Passkey Authenticator

This Soroban contract verifies WebAuthn `webauthn.get` assertions using the
native secp256r1 verifier. A passkey is registered with its SEC-1 public key,
trusted origin, and SHA-256 RP ID hash. The account owner sets a one-time
base64url challenge before an assertion can be verified.

`verify_passkey_auth` validates the WebAuthn client data, challenge, origin,
authenticator RP ID hash, User Presence and User Verification flags, then
verifies the WebAuthn signing digest:

`SHA256(authenticatorData || SHA256(clientDataJSON))`

The pending challenge is removed after successful verification. The SDK's
native secp256r1 verifier traps when the signature is invalid.