from __future__ import annotations

import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator


ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", ROOT / "daily_split.sqlite3"))
ARC_CHAIN_ID = 5_042_002
ARC_RPC_URL = "https://rpc.testnet.arc.network"
ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def money(value: Decimal | float | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def split_evenly(total: Decimal, count: int) -> list[Decimal]:
    if count <= 0:
        raise ValueError("At least one participant is required")
    base = (total / count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    amounts = [base for _ in range(count)]
    drift = total - sum(amounts)
    amounts[-1] = money(amounts[-1] + drift)
    return amounts


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bills (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                total_amount TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USDC',
                organizer_name TEXT NOT NULL,
                organizer_wallet TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS participants (
                id TEXT PRIMARY KEY,
                bill_id TEXT NOT NULL,
                name TEXT NOT NULL,
                wallet TEXT NOT NULL DEFAULT '',
                amount_due TEXT NOT NULL,
                paid INTEGER NOT NULL DEFAULT 0,
                paid_tx TEXT NOT NULL DEFAULT '',
                paid_at TEXT,
                FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
            );
            """
        )


class ParticipantIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    wallet: str = ""
    amount: Decimal | None = None

    @field_validator("amount")
    @classmethod
    def amount_must_be_positive(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value <= 0:
            raise ValueError("amount must be positive")
        return value


class BillCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    total_amount: Decimal = Field(gt=0)
    organizer_name: str = Field(min_length=1, max_length=80)
    organizer_wallet: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=300)
    participants: list[ParticipantIn] = Field(min_length=1, max_length=40)


class PaidUpdate(BaseModel):
    paid: bool = True
    tx_hash: str = ""


app = FastAPI(title="USDC Daily Split", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "USDC Daily Split",
        "network": "Arc Testnet",
        "chain_id": ARC_CHAIN_ID,
    }


@app.get("/api/config")
def config() -> dict:
    return {
        "chainId": ARC_CHAIN_ID,
        "chainName": "Arc Testnet",
        "rpcUrl": ARC_RPC_URL,
        "usdcAddress": ARC_USDC_ADDRESS,
        "usdcDecimals": 6,
    }


@app.post("/api/bills", status_code=201)
def create_bill(payload: BillCreate) -> dict:
    total = money(payload.total_amount)
    explicit = [p.amount is not None for p in payload.participants]
    if any(explicit) and not all(explicit):
        raise HTTPException(status_code=400, detail="Use either equal split or custom amount for everyone")

    if all(explicit):
        amounts = [money(p.amount) for p in payload.participants if p.amount is not None]
        if sum(amounts) != total:
            raise HTTPException(status_code=400, detail="Participant amounts must add up to total")
    else:
        amounts = split_evenly(total, len(payload.participants))

    bill_id = uuid.uuid4().hex[:12]
    created_at = now_iso()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO bills (id, title, total_amount, currency, organizer_name, organizer_wallet, note, created_at)
            VALUES (?, ?, ?, 'USDC', ?, ?, ?, ?)
            """,
            (
                bill_id,
                payload.title.strip(),
                str(total),
                payload.organizer_name.strip(),
                payload.organizer_wallet.strip(),
                payload.note.strip(),
                created_at,
            ),
        )
        for participant, amount in zip(payload.participants, amounts):
            conn.execute(
                """
                INSERT INTO participants (id, bill_id, name, wallet, amount_due)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex[:12],
                    bill_id,
                    participant.name.strip(),
                    participant.wallet.strip(),
                    str(amount),
                ),
            )

    return get_bill(bill_id)


@app.get("/api/bills")
def list_bills() -> dict:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT b.*, COUNT(p.id) AS participant_count, SUM(p.paid) AS paid_count
            FROM bills b
            LEFT JOIN participants p ON p.bill_id = b.id
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT 30
            """
        ).fetchall()
    return {"bills": [dict(row) for row in rows]}


@app.get("/api/bills/{bill_id}")
def get_bill(bill_id: str) -> dict:
    with db() as conn:
        bill = conn.execute("SELECT * FROM bills WHERE id = ?", (bill_id,)).fetchone()
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found")
        participants = conn.execute(
            "SELECT * FROM participants WHERE bill_id = ? ORDER BY rowid ASC",
            (bill_id,),
        ).fetchall()

    participant_dicts = [dict(row) for row in participants]
    total_paid = sum(money(p["amount_due"]) for p in participant_dicts if p["paid"])
    outstanding = money(Decimal(str(bill["total_amount"])) - total_paid)
    return {
        "bill": dict(bill),
        "participants": participant_dicts,
        "summary": {
            "paid_count": sum(1 for p in participant_dicts if p["paid"]),
            "participant_count": len(participant_dicts),
            "total_paid": str(total_paid),
            "outstanding": str(outstanding),
        },
    }


@app.patch("/api/participants/{participant_id}/paid")
def update_paid(participant_id: str, payload: PaidUpdate) -> dict:
    with db() as conn:
        participant = conn.execute(
            "SELECT bill_id FROM participants WHERE id = ?",
            (participant_id,),
        ).fetchone()
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")

        conn.execute(
            """
            UPDATE participants
            SET paid = ?, paid_tx = ?, paid_at = ?
            WHERE id = ?
            """,
            (
                1 if payload.paid else 0,
                payload.tx_hash.strip() if payload.paid else "",
                now_iso() if payload.paid else None,
                participant_id,
            ),
        )
        bill_id = participant["bill_id"]

    return get_bill(bill_id)
