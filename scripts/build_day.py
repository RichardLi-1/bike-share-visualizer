"""Build the data file for the animated-day map.

Reads one day of Bike Share Toronto trips, joins station coordinates from the
GBFS feed, routes every station pair along the OpenStreetMap bike network and
writes a compact JSON file for the deck.gl TripsLayer.

Usage:
    python scripts/build_day.py <ridership zip or csv> <YYYY-MM-DD> [out.json] [extra-stations.json]

extra-stations.json maps station IDs to [lon, lat] for stations that have left
the live feed (see convert_2017.py).

Output shape:
    {
      "date": "2026-08-13",
      "stations": [[lon, lat, departures], ...],
      "routes":   [[lon0, lat0, lon1, lat1, ...], ...],   # flat coords
      "dists":    [[0, d1, d2, ...], ...],                # cumulative metres per vertex
      "trips":    [[routeIdx, startSec, endSec, isCasual, isEbike], ...],
      "stats":    {...}
    }
"""

import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import LineString

GBFS = "https://tor.publicbikesystem.net/ube/gbfs/v1/en/station_information"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
EBIKES = {"EFIT", "EFIT G5", "ASTRO"}
MIN_SECONDS, MAX_SECONDS = 60, 3 * 3600

ox.settings.cache_folder = str(CACHE / "osmnx")
ox.settings.requests_timeout = 300


def load_trips(src: str, day: str) -> pd.DataFrame:
    if src.endswith(".zip"):
        z = zipfile.ZipFile(src)
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        frames = [pd.read_csv(z.open(n), encoding="latin-1", low_memory=False) for n in names]
        df = pd.concat(frames, ignore_index=True)
    else:
        df = pd.read_csv(src, encoding="latin-1", low_memory=False)
    df["Start_Time"] = pd.to_datetime(df["Start_Time"])
    df["End_Time"] = pd.to_datetime(df["End_Time"])
    return df[df["Start_Time"].dt.strftime("%Y-%m-%d") == day].copy()


def load_stations() -> dict[int, tuple[float, float]]:
    CACHE.mkdir(exist_ok=True)
    snap = CACHE / "station_information.json"
    if not snap.exists():
        snap.write_bytes(urllib.request.urlopen(GBFS).read())
    stations = json.loads(snap.read_text())["data"]["stations"]
    return {int(s["station_id"]): (s["lon"], s["lat"]) for s in stations}


def load_graph(lons, lats) -> nx.MultiDiGraph:
    # retain_all keeps the Toronto Islands, which no bridge joins to the mainland.
    path = CACHE / "toronto_bike_with_islands.graphml"
    if path.exists():
        return ox.load_graphml(path)
    pad = 0.01
    bbox = (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)
    G = ox.graph_from_bbox(bbox, network_type="bike", simplify=True, retain_all=True)
    ox.save_graphml(G, path)
    return G


def edge_coords(G, u, v):
    data = min(G.get_edge_data(u, v).values(), key=lambda d: d.get("length", 0))
    if "geometry" in data:
        xs, ys = data["geometry"].xy
        pts = list(zip(xs, ys))
        # Edge geometry may run v -> u; orient it to start at u.
        ux, uy = G.nodes[u]["x"], G.nodes[u]["y"]
        if (pts[0][0] - ux) ** 2 + (pts[0][1] - uy) ** 2 > (pts[-1][0] - ux) ** 2 + (pts[-1][1] - uy) ** 2:
            pts.reverse()
        return pts
    return [(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]


def route_pairs(G, pairs, station_node, coords):
    """Shortest bike paths for every (start, end) station pair, batched by origin."""
    nodes = list(G.nodes)
    index = {n: i for i, n in enumerate(nodes)}
    rows, cols, weights = [], [], []
    for u, v, d in G.edges(data=True):
        rows.append(index[u]); cols.append(index[v]); weights.append(d.get("length", 1.0))
    n = len(nodes)
    directed = csr_matrix((weights, (rows, cols)), shape=(n, n))
    # Fallback for pairs a strict one-way graph can't connect.
    undirected = directed.maximum(directed.T)

    by_origin: dict[int, list[int]] = {}
    for a, b in pairs:
        by_origin.setdefault(a, []).append(b)

    origins = list(by_origin)
    paths = {}
    batch = 64
    for i in range(0, len(origins), batch):
        chunk = origins[i : i + batch]
        src_idx = [index[station_node[a]] for a in chunk]
        for graph, label in ((directed, "directed"), (undirected, "undirected")):
            todo = [(k, a) for k, a in enumerate(chunk) if any((a, b) not in paths for b in by_origin[a])]
            if not todo:
                break
            dist, pred = dijkstra(graph, indices=[src_idx[k] for k, _ in todo], return_predecessors=True)
            for row, (k, a) in enumerate(todo):
                for b in by_origin[a]:
                    if (a, b) in paths:
                        continue
                    t = index[station_node[b]]
                    if np.isinf(dist[row, t]):
                        continue
                    seq = [t]
                    while seq[-1] != src_idx[k]:
                        seq.append(pred[row, seq[-1]])
                    seq = [nodes[j] for j in reversed(seq)]
                    pts = [coords[a]]
                    for u, v in zip(seq, seq[1:]):
                        if G.has_edge(u, v):
                            seg = edge_coords(G, u, v)
                        else:
                            seg = list(reversed(edge_coords(G, v, u)))
                        pts.extend(seg)
                    pts.append(coords[b])
                    paths[(a, b)] = pts
        print(f"  routed origins {min(i + batch, len(origins))}/{len(origins)}", flush=True)
    return paths


def compact(pts):
    line = LineString(pts).simplify(0.00003)
    xy = [(round(x, 5), round(y, 5)) for x, y in line.coords]
    out = [xy[0]]
    for p in xy[1:]:
        if p != out[-1]:
            out.append(p)
    lat0 = np.radians(out[0][1])
    cum = [0.0]
    for (x0, y0), (x1, y1) in zip(out, out[1:]):
        dx = (x1 - x0) * 111_320 * np.cos(lat0)
        dy = (y1 - y0) * 110_540
        cum.append(cum[-1] + float(np.hypot(dx, dy)))
    if len(out) == 1:
        out.append(out[0]); cum.append(0.0)
    return [c for p in out for c in p], [round(c) for c in cum]


def main():
    src, day = sys.argv[1], sys.argv[2]
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "public" / "data" / f"day-{day}.json"

    print(f"Loading trips for {day}")
    df = load_trips(src, day)
    total = len(df)
    df = df.dropna(subset=["End_Station_Id"])
    df["End_Station_Id"] = df["End_Station_Id"].astype(int)
    df["Start_Station_Id"] = df["Start_Station_Id"].astype(int)
    dur = (df["End_Time"] - df["Start_Time"]).dt.total_seconds()
    df = df[(dur >= MIN_SECONDS) & (dur <= MAX_SECONDS)]

    coords = load_stations()
    if len(sys.argv) > 4:
        extra = json.loads(Path(sys.argv[4]).read_text())
        coords |= {int(k): tuple(v) for k, v in extra.items()}
    known = df["Start_Station_Id"].isin(coords) & df["End_Station_Id"].isin(coords)
    unknown = int((~known).sum())
    df = df[known]
    loops = df["Start_Station_Id"] == df["End_Station_Id"]
    round_trips = int(loops.sum())
    df = df[~loops]
    print(f"  {total} trips; kept {len(df)} (no location {unknown}, round trips {round_trips})")

    ids = sorted(set(df["Start_Station_Id"]) | set(df["End_Station_Id"]))
    lons = [coords[i][0] for i in ids]
    lats = [coords[i][1] for i in ids]
    print("Loading OSM bike network")
    G = load_graph(lons, lats)
    # Keep every sizable component, not just the largest: the Toronto Islands
    # have their own street network, joined to the mainland only by ferry.
    # Pairs across components fall back to a straight line.
    keep = set().union(*(c for c in nx.weakly_connected_components(G) if len(c) >= 50))
    G = G.subgraph(keep).copy()
    nearest = ox.distance.nearest_nodes(G, lons, lats)
    station_node = dict(zip(ids, nearest))

    pairs = sorted(set(zip(df["Start_Station_Id"], df["End_Station_Id"])))
    print(f"Routing {len(pairs)} station pairs")
    paths = route_pairs(G, pairs, station_node, coords)

    route_index, routes, dists = {}, [], []
    for pair in pairs:
        pts = paths.get(pair) or [coords[pair[0]], coords[pair[1]]]
        flat, cum = compact(pts)
        route_index[pair] = len(routes)
        routes.append(flat)
        dists.append(cum)

    midnight = pd.Timestamp(day)
    trips = []
    for r in df.sort_values("Start_Time").itertuples(index=False):
        trips.append([
            route_index[(r.Start_Station_Id, r.End_Station_Id)],
            int((r.Start_Time - midnight).total_seconds()),
            int((r.End_Time - midnight).total_seconds()),
            int(r.User_Type == "Casual"),
            int(getattr(r, "Bike_Model", "") in EBIKES),
        ])

    departures = df["Start_Station_Id"].value_counts()
    stations = [[coords[i][0], coords[i][1], int(departures.get(i, 0))] for i in ids]

    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "date": day,
        "stations": stations,
        "routes": routes,
        "dists": dists,
        "trips": trips,
        "stats": {
            "tripsInFile": total,
            "tripsShown": len(trips),
            "roundTripsSkipped": round_trips,
            "noLocationSkipped": unknown,
            "unroutedPairs": sum(1 for p in pairs if p not in paths),
        },
    }
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    print(json.dumps(payload["stats"]))


if __name__ == "__main__":
    main()
