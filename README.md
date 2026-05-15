# USDC Daily Split

Simple daily bill splitting with optional Arc Testnet USDC payment.

Create a bill, split it with friends, share a link, and track who has paid. The app never asks for private keys. Wallet payments happen only in the user's browser through their wallet.

## Features

- Create a USDC bill
- Equal split by default
- Optional custom amounts
- Shareable bill link
- Paid/unpaid tracking
- Optional Arc Testnet USDC transfer
- SQLite storage
- No server-side custody

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
```

The backend stores bill records only. It does not hold funds and does not sign transactions.

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

## Tests

```powershell
python -m unittest discover -s tests -p "test_*.py"
```
