"""Tests for the terminal map compiler.
Run: docker compose run --rm terminal-map-test
"""

from __future__ import annotations

import math
import unittest
from pathlib import Path

import numpy as np

import mapbuild
import mds
import nodes

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
COMMITTED = HERE.parents[1] / "src" / "data" / "terminalMap" / "4.10.2.json"
VERSION = "4.10.2"

POINTS = np.array([[0.0, 0.0], [10.0, 0.0], [3.0, 7.0], [-4.0, 5.0], [8.0, -6.0], [-7.0, -3.0]])


def distance_matrix(points: np.ndarray) -> np.ndarray:
    diff = points[:, None, :] - points[None, :, :]
    return np.sqrt((diff * diff).sum(axis=2))


class MdsTests(unittest.TestCase):
    def test_recovers_a_planar_configuration(self):
        d = distance_matrix(POINTS)
        known = ~np.eye(len(d), dtype=bool)
        x, share = mds.embed(d, known, "1/d")
        self.assertLess(mds.quality(d, known, x)["stress1"], 1e-6)
        self.assertAlmostEqual(share, 1.0, places=6)

    def test_canonical_frame_ignores_rotation_and_reflection(self):
        angle = 0.7
        rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
        mirror = np.array([[1.0, 0.0], [0.0, -1.0]])
        base = mds.canonical_frame(POINTS)
        for variant in (POINTS @ rotation, POINTS @ mirror, POINTS @ rotation @ mirror + 5.0):
            self.assertTrue(np.allclose(mds.canonical_frame(variant), base, atol=1e-9))

    def test_canonical_frame_is_centred_with_largest_variance_on_x(self):
        y = mds.canonical_frame(POINTS)
        self.assertTrue(np.allclose(y.mean(axis=0), 0.0, atol=1e-12))
        self.assertGreaterEqual(y[:, 0].var(), y[:, 1].var())

    def test_missing_pairs_are_filled_by_shortest_path(self):
        d = np.array([[0, 1, 0], [1, 0, 2], [0, 2, 0]], dtype=float)
        known = np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]], dtype=bool)
        self.assertEqual(mds.fill_missing(d, known)[0, 2], 3.0)

    def test_disconnected_points_are_rejected(self):
        known = np.zeros((3, 3), dtype=bool)
        with self.assertRaises(ValueError):
            mds.fill_missing(np.zeros((3, 3)), known)

    def test_embedding_is_repeatable(self):
        d = distance_matrix(POINTS)
        known = ~np.eye(len(d), dtype=bool)
        first, _ = mds.embed(d, known, "1/d")
        second, _ = mds.embed(d, known, "1/d")
        self.assertTrue(np.array_equal(first, second))


class HelperTests(unittest.TestCase):
    def test_game_versions_sort_numerically(self):
        order = sorted(["4.10.2", "4.7.1", "3.24.2a", "3.24.2", "4.3.2"], key=mapbuild._version_key)
        self.assertEqual(order, ["3.24.2", "3.24.2a", "4.3.2", "4.7.1", "4.10.2"])

    def test_co_orbit_nodes_sit_on_a_ring_around_their_planet(self):
        members = [
            {"id": "planet:1", "kind": "planet", "orbit": 7},
            {"id": "moon:5", "kind": "moon", "orbit": 7},
            {"id": "moon:2", "kind": "moon", "orbit": 7},
            {"id": "station:9", "kind": "station", "orbit": 7},
            {"id": "station:3", "kind": "station", "orbit": 8},
        ]
        placed = mapbuild.spread_co_orbit(members, {7: (10.0, 20.0), 8: (1.0, 2.0)})
        self.assertEqual(placed["planet:1"], (10.0, 20.0, False))
        self.assertEqual(placed["station:3"], (1.0, 2.0, False))
        for node_id in ("moon:5", "moon:2", "station:9"):
            x, y, offset = placed[node_id]
            self.assertTrue(offset)
            self.assertAlmostEqual(math.hypot(x - 10.0, y - 20.0), mapbuild.CO_ORBIT_SPREAD, places=2)
        # moons first (by id), then stations
        self.assertEqual(placed["moon:2"][:2], (10.15, 20.0))


class CompiledMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = mapbuild.compile_version(RAW, VERSION)
        cls.data = mapbuild.compile_data(RAW, VERSION)

    def test_same_input_gives_the_same_bytes(self):
        self.assertEqual(self.text, mapbuild.compile_version(RAW, VERSION))

    def test_committed_file_is_up_to_date(self):
        self.assertEqual(COMMITTED.read_text(encoding="utf-8", newline=""), self.text)

    def test_node_counts_per_system(self):
        counts = {s["name"]: sum(1 for n in self.data["nodes"] if n["system"] == s["id"]) for s in self.data["systems"]}
        self.assertEqual(counts, {"Nyx": 7, "Pyro": 22, "Stanton": 42})

    def test_wikelo_is_ignored_and_terra_gateway_is_kept_without_a_jump(self):
        ids = {n["id"] for n in self.data["nodes"]}
        self.assertFalse({"station:51", "station:52", "station:53"} & ids)
        self.assertIn("station:26", ids)
        self.assertNotIn("station:26", {end for j in self.data["jumps"] for end in (j["a"], j["b"])})

    def test_three_jumps_of_70_gm_between_gateway_stations(self):
        jumps = {(j["a"], j["b"]): j["cost"] for j in self.data["jumps"]}
        self.assertEqual(len(jumps), 3)
        self.assertEqual(set(jumps.values()), {70.0})
        self.assertEqual({frozenset(k) for k in jumps}, {
            frozenset({"station:24", "station:50"}),
            frozenset({"station:25", "station:56"}),
            frozenset({"station:55", "station:57"}),
        })

    def test_every_terminal_maps_to_exactly_one_node(self):
        listed = [t for n in self.data["nodes"] for t in n["terminalIds"]]
        self.assertEqual(len(listed), len(set(listed)))
        self.assertEqual(set(map(int, self.data["terminalNode"])), set(listed))

    def test_groups_follow_the_planet(self):
        group = {n["id"]: n["group"] for n in self.data["nodes"]}
        self.assertEqual(group["moon:1"], "planet:116")  # Aberdeen -> Hurston
        self.assertEqual(group["station:10"], "planet:116")  # Everus Harbor
        self.assertEqual(group["planet:116"], "planet:116")
        self.assertIsNone(group["station:24"])  # gateway: standalone

    def test_fit_is_good(self):
        for system in self.data["systems"]:
            quality = system["quality"]
            self.assertLess(quality["stress1"], 0.03, system["name"])
            self.assertGreater(quality["planarShare"], 0.9, system["name"])
            self.assertEqual(quality["estimatedPairs"], len(system["estimated"]))

    def test_fitted_distance_matches_the_report(self):
        by_id = {n["id"]: n for n in self.data["nodes"]}
        distance = math.hypot(
            by_id["planet:116"]["x"] - by_id["planet:4"]["x"], by_id["planet:116"]["y"] - by_id["planet:4"]["y"]
        )
        self.assertAlmostEqual(distance, 23.0, delta=1.0)  # Hurston <-> ArcCorp, reported 23 Gm

    def test_co_orbit_nodes_are_spread_by_the_configured_radius(self):
        by_id = {n["id"]: n for n in self.data["nodes"]}
        for moon in ("moon:1", "moon:4", "moon:45", "moon:51"):
            self.assertTrue(by_id[moon]["offset"])
            self.assertAlmostEqual(
                math.hypot(by_id[moon]["x"] - by_id["planet:116"]["x"], by_id[moon]["y"] - by_id["planet:116"]["y"]),
                mapbuild.CO_ORBIT_SPREAD,
                delta=0.002,
            )

    def test_system_panels_do_not_overlap(self):
        layout = {s["id"]: s["layout"] for s in self.data["systems"]}
        radius = {
            s["id"]: max(math.hypot(n["x"], n["y"]) for n in self.data["nodes"] if n["system"] == s["id"])
            for s in self.data["systems"]
        }
        ids = sorted(layout)
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                gap = math.hypot(layout[a]["cx"] - layout[b]["cx"], layout[a]["cy"] - layout[b]["cy"])
                self.assertGreater(gap, radius[a] + radius[b])

    def test_snapshot_has_only_the_listed_fields(self):
        snapshot = nodes.load_snapshot(RAW, VERSION)
        for endpoint, records in snapshot.items():
            self.assertEqual(set(records[0]), set(nodes.META_FIELDS[endpoint]), endpoint)


if __name__ == "__main__":
    unittest.main()
