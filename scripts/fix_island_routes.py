"""Reroute Toronto Islands rides on the Islands' own paths.

Day files built before build_day.py kept disconnected networks snapped Island
stations to mainland streets, so rides between Island stations were drawn
hopping across the harbour. This repairs such a file without the raw ridership
data. Rides between the mainland and the Islands went by ferry, have no path to
draw, and are removed. Standard library only.

Usage:
    python scripts/fix_island_routes.py public/data/day-2026-08-13.json
"""

import heapq
import json
import math
import sys
from pathlib import Path

# The raw OpenStreetMap response OSMnx cached during build_day.py.
OSM_CACHE = Path(__file__).resolve().parent.parent / ".cache" / "osmnx"
SOUTH, WEST, NORTH, EAST = 43.60, -79.402, 43.632, -79.345

def on_islands(lon, lat):
    return WEST < lon < EAST and SOUTH < lat < NORTH


def metres(a, b):
    k = math.cos(math.radians(43.62))
    return math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_540)


def load_graph():
    elements = json.loads(next(OSM_CACHE.glob("*.json")).read_text())["elements"]
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in elements if e["type"] == "node"}
    graph = {}
    for way in elements:
        if way["type"] != "way":
            continue
        points = [nodes[n] for n in way["nodes"] if n in nodes]
        for a, b in zip(points, points[1:]):
            if on_islands(*a) and on_islands(*b):
                d = metres(a, b)
                graph.setdefault(a, []).append((b, d))
                graph.setdefault(b, []).append((a, d))
    return graph


def largest_component(graph):
    seen, best = set(), set()
    for start in graph:
        if start in seen:
            continue
        stack, part = [start], {start}
        while stack:
            for nxt, _ in graph[stack.pop()]:
                if nxt not in part:
                    part.add(nxt)
                    stack.append(nxt)
        seen |= part
        best = max(best, part, key=len)
    return {n: graph[n] for n in best}


def shortest_paths(graph, source):
    dist, prev, heap = {source: 0.0}, {}, [(0.0, source)]
    while heap:
        d, node = heapq.heappop(heap)
        if d > dist[node]:
            continue
        for nxt, w in graph[node]:
            if d + w < dist.get(nxt, math.inf):
                dist[nxt], prev[nxt] = d + w, node
                heapq.heappush(heap, (d + w, nxt))
    return prev


def main():
    path = Path(sys.argv[1])
    day = json.loads(path.read_text())
    graph = largest_component(load_graph())
    print(f"Island path network: {len(graph)} points")

    snapped = {}
    for lon, lat, _ in day["stations"]:
        if on_islands(lon, lat):
            key = (round(lon, 5), round(lat, 5))
            snapped[key] = min(graph, key=lambda n: metres(n, key))
            print(f"  station {key} is {metres(snapped[key], key):.0f} m from a path")

    trees, fixed = {}, 0
    for i, route in enumerate(day["routes"]):
        a, b = (route[0], route[1]), (route[-2], route[-1])
        if a not in snapped or b not in snapped:
            continue
        tree = trees.setdefault(a, shortest_paths(graph, snapped[a]))
        chain = [snapped[b]]
        while chain[-1] != snapped[a]:
            chain.append(tree[chain[-1]])
        points = [a, *reversed(chain), b]
        points = [(round(x, 5), round(y, 5)) for x, y in points]
        points = [p for j, p in enumerate(points) if j == 0 or p != points[j - 1]]
        if len(points) == 1:
            points.append(points[0])
        cumulative = [0.0]
        for p, q in zip(points, points[1:]):
            cumulative.append(cumulative[-1] + metres(p, q))
        day["routes"][i] = [c for p in points for c in p]
        day["dists"][i] = [round(c) for c in cumulative]
        fixed += 1

    def crosses_harbour(trip):
        route = day["routes"][trip[0]]
        return ((route[0], route[1]) in snapped) != ((route[-2], route[-1]) in snapped)

    kept = [t for t in day["trips"] if not crosses_harbour(t)]
    ferry = len(day["trips"]) - len(kept)
    day["trips"] = kept
    day["stats"]["tripsShown"] = len(kept)
    day["stats"]["ferrySkipped"] = day["stats"].get("ferrySkipped", 0) + ferry

    path.write_text(json.dumps(day, separators=(",", ":")))
    print(f"Rerouted {fixed} routes between Island stations; removed {ferry} ferry rides")


if __name__ == "__main__":
    main()
