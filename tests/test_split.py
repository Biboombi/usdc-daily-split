import unittest
from decimal import Decimal
from tempfile import TemporaryDirectory
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as app_main
from app.main import app, money, split_evenly


class SplitTests(unittest.TestCase):
    def test_even_split(self):
        self.assertEqual(
            split_evenly(Decimal("30.00"), 3),
            [Decimal("10.00"), Decimal("10.00"), Decimal("10.00")],
        )

    def test_rounding_drift_goes_to_last_person(self):
        self.assertEqual(
            split_evenly(Decimal("10.00"), 3),
            [Decimal("3.33"), Decimal("3.33"), Decimal("3.34")],
        )

    def test_money_rounds_half_up(self):
        self.assertEqual(money("1.235"), Decimal("1.24"))

    def test_requires_participant(self):
        with self.assertRaises(ValueError):
            split_evenly(Decimal("10.00"), 0)


class PaymentIntentTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.original_db_path = app_main.DATABASE_PATH
        app_main.DATABASE_PATH = Path(self.temp_dir.name) / "test.sqlite3"
        app_main.init_db()
        self.client = TestClient(app)

    def tearDown(self):
        app_main.DATABASE_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_payment_intent_ties_arc_usdc_to_participant(self):
        created = self.client.post(
            "/api/bills",
            json={
                "title": "Dinner",
                "total_amount": "10.00",
                "organizer_name": "Alex",
                "organizer_wallet": "0x8075dE962BcEf1dF183b82dAD30Ac260F61798fF",
                "participants": [{"name": "Me"}, {"name": "Friend"}],
            },
        )
        self.assertEqual(created.status_code, 201)
        payload = created.json()
        participant_id = payload["participants"][0]["id"]

        response = self.client.get(f"/api/participants/{participant_id}/payment-intent")

        self.assertEqual(response.status_code, 200)
        intent = response.json()
        self.assertEqual(intent["bill_id"], payload["bill"]["id"])
        self.assertEqual(intent["participant_id"], participant_id)
        self.assertEqual(intent["chain_id"], 5042002)
        self.assertEqual(intent["rpc_url"], "https://rpc.testnet.arc.network")
        self.assertEqual(intent["explorer_url"], "https://testnet.arcscan.app")
        self.assertEqual(intent["token"]["symbol"], "USDC")
        self.assertEqual(intent["token"]["address"], "0x3600000000000000000000000000000000000000")
        self.assertEqual(intent["transfer"]["amount"], "5.00")
        self.assertEqual(intent["transfer"]["amount_units"], "5000000")
        self.assertEqual(intent["transfer"]["to"], payload["bill"]["organizer_wallet"])

    def test_config_matches_arc_testnet_docs(self):
        response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200)
        config = response.json()
        self.assertEqual(config["chainId"], 5042002)
        self.assertEqual(config["rpcUrl"], "https://rpc.testnet.arc.network")
        self.assertEqual(config["usdcAddress"], "0x3600000000000000000000000000000000000000")
        self.assertEqual(config["usdcDecimals"], 6)
        self.assertEqual(config["nativeCurrency"], {"name": "USDC", "symbol": "USDC", "decimals": 18})
        self.assertEqual(config["blockExplorerUrl"], "https://testnet.arcscan.app")
        self.assertEqual(config["faucetUrl"], "https://faucet.circle.com")

    def test_payment_status_flow_tracks_pending_and_confirmed(self):
        created = self.client.post(
            "/api/bills",
            json={
                "title": "Dinner",
                "total_amount": "10.00",
                "organizer_name": "Alex",
                "organizer_wallet": "0x8075dE962BcEf1dF183b82dAD30Ac260F61798fF",
                "participants": [{"name": "Me"}, {"name": "Friend"}],
            },
        )
        self.assertEqual(created.status_code, 201)
        participant_id = created.json()["participants"][0]["id"]
        tx_hash = "0x" + "a" * 64

        pending = self.client.patch(
            f"/api/participants/{participant_id}/payment-status",
            json={"status": "pending", "tx_hash": tx_hash},
        )
        self.assertEqual(pending.status_code, 200)
        pending_participant = pending.json()["participants"][0]
        self.assertEqual(pending_participant["payment_status"], "pending")
        self.assertEqual(pending_participant["paid"], 0)
        self.assertEqual(pending_participant["paid_tx"], tx_hash)
        self.assertEqual(pending.json()["summary"]["total_paid"], "0.00")

        confirmed = self.client.patch(
            f"/api/participants/{participant_id}/payment-status",
            json={"status": "confirmed", "tx_hash": tx_hash},
        )
        self.assertEqual(confirmed.status_code, 200)
        confirmed_participant = confirmed.json()["participants"][0]
        self.assertEqual(confirmed_participant["payment_status"], "confirmed")
        self.assertEqual(confirmed_participant["paid"], 1)
        self.assertEqual(confirmed_participant["paid_tx"], tx_hash)
        self.assertEqual(confirmed.json()["summary"]["total_paid"], "5.00")

    def test_delete_bill_removes_bill(self):
        created = self.client.post(
            "/api/bills",
            json={
                "title": "Lunch",
                "total_amount": "12.00",
                "organizer_name": "Alex",
                "organizer_wallet": "0x8075dE962BcEf1dF183b82dAD30Ac260F61798fF",
                "participants": [{"name": "Me"}, {"name": "Friend"}],
            },
        )
        self.assertEqual(created.status_code, 201)
        bill_id = created.json()["bill"]["id"]

        deleted = self.client.delete(f"/api/bills/{bill_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["bill_id"], bill_id)

        missing = self.client.get(f"/api/bills/{bill_id}")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
