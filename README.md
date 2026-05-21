# USDC Daily Split

Simple daily bill splitting with optional Arc Testnet USDC payment.

Create a bill, split it with friends, share a link, and track who has paid. The app never asks for private keys. Wallet payments happen only in the user's browser through their wallet.

## Features

- Create a USDC bill
- Equal split by default
- Optional custom amounts
- Shareable bill link
- Pending/confirmed/failed payment tracking
- Optional Arc Testnet USDC transfer
- SQLite storage
- No server-side custody
- Backend payment intents tied to bill participants

## Run Locally

```powershell
cd arc-daily-split
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8787
```

Open:

```text
http://localhost:8787
```

Health check:

```text
http://localhost:8787/health
```

## Arc Testnet

The app uses:

```text
Chain: Arc Testnet
Chain ID: 5042002
RPC: https://rpc.testnet.arc.network
USDC: 0x3600000000000000000000000000000000000000
Explorer: https://testnet.arcscan.app
Faucet: https://faucet.circle.com
```

The backend stores bill records and payment status only. It does not hold funds and does not sign transactions.

## Payment Flow

```text
Create bill
-> Share bill link
-> Participant clicks Pay USDC
-> Backend creates a payment intent for that participant
-> Browser wallet sends Arc Testnet USDC to the organizer
-> App stores the transaction hash as pending
-> App marks the payment confirmed or failed after the wallet receipt
```

Payment intents include:

- Bill ID
- Participant ID
- Arc Testnet chain ID
- Arc USDC token address
- Organizer recipient address
- Exact participant amount

## Environment

Copy `.env.example` if you want to customize the database path.

```text
DATABASE_PATH=./daily_split.sqlite3
```

## Deploy

For Render or another Python host:

```text
Build command: pip install -r requirements.txt
Start command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Use persistent disk/storage if you want SQLite data to survive redeploys.

## Safety

- Never ask users for seed phrases.
- Never ask users for private keys.
- Treat this as a payment utility, not financial advice.
- Use Arc Testnet until you intentionally switch networks.

## Guardrails

- Payments limited to Arc USDC only
- Recipient must match the bill organizer
- Amount must match the participant's share
- No backend custody of user funds
- Browser wallet only

## Tests

```powershell
python -m unittest discover -s tests -p "test_*.py"
```
