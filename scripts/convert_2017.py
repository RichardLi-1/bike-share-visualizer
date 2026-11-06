"""Convert one day of 2017 ridership to the layout build_day.py reads.

The 2017 Q3 and Q4 files have station names but no IDs, so names are resolved
in this order:
  1. LANDMARKS and SPELLINGS below
  2. the 2017 Q1-Q2 and 2018 files, which list names with their IDs
  3. the live GBFS station names
  4. where the two streets in the name cross on the OSM network, for stations
     that have closed since

IDs have been reused for other sites (7074 was Spadina Ave / Sussex Ave and is
now King St E / Church St), so an ID only counts if the live station is close
to where the name says it should be.

Usage:
    python scripts/convert_2017.py <2017 zip> <2018 zip> <YYYY-MM-DD> <out.csv> <stations.json>

Then:
    python scripts/build_day.py <out.csv> <YYYY-MM-DD> public/data/day-<YYYY-MM-DD>.json <stations.json>
"""

import collections
import json
import math
import re
import sys
import zipfile
from pathlib import Path

import osmnx as ox
import pandas as pd

CACHE = Path(__file__).resolve().parent.parent / ".cache"

# Names that differ from the live feed only by spelling: 2017 name -> station ID.
SPELLINGS = {
    "Beverly St / College St": 7161,
    "Lower Spadina Ave / Lake Shore Blvd": 7259,
    "Lansdowne Subway Green P": 7180,
}
# Places the street names can't locate: 2017 name -> (lon, lat).
LANDMARKS = {
    "Ontario Place Blvd / Remembrance Dr": (-79.4128, 43.6308),
    "Bridgeman Ave / Kendal Ave": (-79.40983, 43.67549),
    "Queen St W / James St": (-79.3818, 43.6520),
    "Chester Station": (-79.3526, 43.6783),
    "Exhibition GO (Atlantic Ave)": (-79.4190, 43.6357),
    "Woodbine Subway Green P (Cedarvale Ave)": (-79.3130, 43.6866),
    "The Royal Ontario Museum (Bloor St Entrance)": (-79.3948, 43.6683),
    "Bloor GO / UP Station (West Toronto Railpath)": (-79.4430, 43.6585),
    "Pape Subway Green P": (-79.3449, 43.6797),
}
MAX_MOVE_METRES = 300
WORDS = {
    "street": "st", "avenue": "ave", "road": "rd", "drive": "dr", "boulevard": "blvd", "crescent": "cres",
    "court": "crt", "place": "pl", "lane": "ln", "east": "e", "west": "w", "north": "n", "south": "s",
    "saint": "st", "square": "sq", "terrace": "ter",
}


def clean(name):
    name = re.sub(r"\(.*?\)", "", str(name).lower().replace(".", ""))
    words = re.sub(r"[^a-z0-9/ ]+", " ", name).split()
    return " ".join(WORDS.get(w, w) for w in words)


def key(name):
    return " / ".join(sorted(p.strip() for p in clean(name).split("/")))


def street(name):
    """A street name without its direction, so 'queen st w' finds 'Queen Street West'."""
    return re.sub(r" (e|w|n|s)$", "", clean(name).strip())


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 80_500, (a[1] - b[1]) * 110_540)


def shares_word(a, b):
    def words(name):
        return {w for w in re.findall(r"[a-z]+", clean(name)) if len(w) > 2 and w not in ("ave", "blvd", "green")}

    return bool(words(a) & words(b))


def read_zip(path):
    z = zipfile.ZipFile(path)
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    return {n: pd.read_csv(z.open(n), encoding="latin-1", low_memory=False) for n in names}


def known_ids(frames):
    ids = collections.defaultdict(collections.Counter)
    for frame in frames:
        if "from_station_id" not in frame:
            continue
        for id_col, name_col in (("from_station_id", "from_station_name"), ("to_station_id", "to_station_name")):
            pairs = frame[[id_col, name_col]].dropna().value_counts()
            for (station, name), n in pairs.items():
                ids[key(name)][int(station)] += int(n)
    return ids


def street_nodes():
    G = ox.load_graphml(CACHE / "toronto_bike_with_islands.graphml")
    nodes = collections.defaultdict(set)
    for u, v, data in G.edges(data=True):
        names = data.get("name", [])
        for name in names if isinstance(names, list) else [names]:
            nodes[street(name)] |= {u, v}
    return G, nodes


def crossing(name, G, nodes):
    parts = [street(p) for p in re.sub(r"\(.*?\)", "", name).split("/")]
    if len(parts) != 2:
        return None
    shared = nodes.get(parts[0], set()) & nodes.get(parts[1], set())
    if not shared:
        return None
    xs = [G.nodes[n]["x"] for n in shared]
    ys = [G.nodes[n]["y"] for n in shared]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def main():
    src17, src18, day, out, stations_out = sys.argv[1:6]
    files17 = read_zip(src17)
    frames = [*files17.values(), *read_zip(src18).values()]
    no_ids = pd.concat([f for f in files17.values() if "from_station_id" not in f], ignore_index=True)
    # Q3 writes 7/1/2017 0:00 and Q4 writes 10/01/17 00:00:01.
    no_ids["start"] = pd.to_datetime(no_ids["trip_start_time"], format="mixed")
    trips = no_ids[no_ids["start"].dt.strftime("%Y-%m-%d") == day].copy()

    feed = json.loads((CACHE / "station_information.json").read_text())["data"]["stations"]
    live = {int(s["station_id"]): s for s in feed}
    by_name = {key(s["name"]): int(s["station_id"]) for s in feed}
    ids = known_ids(frames)
    G, nodes = street_nodes()

    resolved, extra, methods, lost = {}, {}, collections.Counter(), collections.Counter()
    next_id = 90000
    uses = collections.Counter([*trips["from_station_name"], *trips["to_station_name"]])
    for name, n in uses.items():
        k = key(name)
        station = ids[k].most_common(1)[0][0] if k in ids else None
        place = LANDMARKS.get(name) or crossing(name, G, nodes)
        if station in live and name not in LANDMARKS:
            spot = (live[station]["lon"], live[station]["lat"])
            same_site = metres(place, spot) <= MAX_MOVE_METRES if place else shares_word(name, live[station]["name"])
            if not same_site:
                print(f"  ID {station} is now {live[station]['name']!r}, not {name!r}")
                station = None
        if name in SPELLINGS:
            resolved[name] = SPELLINGS[name]
            methods["spelling"] += n
        elif station in live and name not in LANDMARKS:
            resolved[name] = station
            methods["id"] += n
        elif k in by_name:
            resolved[name] = by_name[k]
            methods["live name"] += n
        else:
            if place is None:
                lost[name] = n
                continue
            # A closed station keeps its ID; a reused or unknown one gets a new ID.
            if station is None or station in live:
                station, next_id = next_id, next_id + 1
            resolved[name] = station
            extra[station] = place
            methods["landmark" if name in LANDMARKS else "street crossing"] += n
            print(f"  {n:4} {name} -> {place[0]:.5f}, {place[1]:.5f}")
    print("Ride endpoints by method:", dict(methods))
    print("Not placed:", dict(lost))

    trips = trips[trips["from_station_name"].isin(resolved) & trips["to_station_name"].isin(resolved)]
    pd.DataFrame({
        "Start_Time": trips["start"],
        "End_Time": trips["start"] + pd.to_timedelta(trips["trip_duration_seconds"], unit="s"),
        "Start_Station_Id": trips["from_station_name"].map(resolved),
        "End_Station_Id": trips["to_station_name"].map(resolved),
        "User_Type": trips["user_type"],
    }).to_csv(out, index=False)
    Path(stations_out).write_text(json.dumps(extra))
    print(f"Wrote {len(trips)} of {sum(uses.values()) // 2} rides, {len(extra)} stations not in the live feed")


if __name__ == "__main__":
    main()
