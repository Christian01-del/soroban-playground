# Weather Oracle

A production-ready Soroban smart contract that provides tamper-resistant weather
data for on-chain applications such as insurance protocols and weather derivatives.

## Features

- **Multi-source verification** – data is confirmed by multiple independent sources
  before it is marked `Verified`
- **Configurable threshold** – admin sets how many confirmations are required
- **Input validation** – temperature, humidity, and wind speed are validated against
  realistic physical bounds
- **Circuit breaker** – admin can halt all data submissions instantly
- **Pause/unpause** – emergency pause for all state-changing operations
- **Historical lookups** – retrieve any past record by location + observation timestamp
- **Event emissions** – `init`, `paused`, `unpaused`, `circuit`, `srcAdd`, `srcUpd`,
  `thresh`, `wSubmit`, `verified`

## Contract Functions

### Admin

| Function                                       | Description                    |
| ---------------------------------------------- | ------------------------------ |
| `initialize(admin, verification_threshold?)`   | One-time setup                 |
| `pause(admin)` / `unpause(admin)`              | Emergency pause                |
| `set_circuit_breaker(admin, active)`           | Block/unblock submissions      |
| `add_data_source(admin, source, name)`         | Register a trusted source      |
| `remove_data_source(admin, source, active)`    | Activate / deactivate a source |
| `set_verification_threshold(admin, threshold)` | Update confirmation count      |

### Data Sources

| Function                                                                                          | Description      |
| ------------------------------------------------------------------------------------------------- | ---------------- |
| `submit_weather_data(source, location, temperature_c, humidity_pct, wind_speed_kmh, observed_at)` | Submit a reading |

### Read-only

| Function                                     | Description                          |
| -------------------------------------------- | ------------------------------------ |
| `get_weather_data(record_id)`                | Fetch record by ID                   |
| `get_historical_data(location, observed_at)` | Fetch record by location + timestamp |
| `get_record_count()`                         | Total records submitted              |
| `get_verification_threshold()`               | Current threshold                    |
| `get_data_source(source)`                    | Source metadata                      |
| `is_paused()`                                | Pause state                          |
| `is_circuit_breaker_active()`                | Circuit breaker state                |
| `get_admin()`                                | Admin address                        |

## Data Format (fixed-point × 100)

All measurements are stored as integers scaled by 100 to avoid floating-point:

| Field            | Unit       | Example value | Meaning    |
| ---------------- | ---------- | ------------- | ---------- |
| `temperature_c`  | °C × 100   | `2150`        | 21.50 °C   |
| `humidity_pct`   | % × 100    | `6500`        | 65.00 %    |
| `wind_speed_kmh` | km/h × 100 | `1500`        | 15.00 km/h |

Valid ranges: temperature −90.00 to +60.00 °C; humidity 0–100 %; wind 0–500 km/h.

## Lifecycle

1. Admin calls `initialize`.
2. Admin registers sources via `add_data_source`.
3. Sources call `submit_weather_data`. The first submission creates a `Pending` record; each subsequent source confirmation increments the counter. When confirmations reach the threshold the record becomes `Verified`.
4. Consumers call `get_weather_data` or `get_historical_data`.

## Build & Test

```bash
cd contracts/weather-oracle

# Run tests
cargo test

# Build WASM
cargo build --target wasm32-unknown-unknown --release
```

## Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/weather_oracle.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet

stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_ACCOUNT> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --verification_threshold 2
```

## License

MIT
