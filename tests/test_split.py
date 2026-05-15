import unittest
from decimal import Decimal

from app.main import money, split_evenly


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


if __name__ == "__main__":
    unittest.main()
