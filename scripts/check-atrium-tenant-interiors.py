"""Check the drawing input before rendering the atrium tenant design."""

from itertools import combinations, pairwise
from math import hypot
from statistics import median


def overlap(a, b):
    return min(a[2], b[2]) - max(a[0], b[0]) > 1e-6 and min(a[3], b[3]) - max(a[1], b[1]) > 1e-6


def rect(u, d, width, depth):
    return (u, d, u + width, d + depth)


def footprint(bay, half_width):
    start, end = bay["span"]
    depth = bay["depth"]
    if bay["side"] == "west":
        return (-half_width - depth, start, -half_width, end)
    if bay["side"] == "east":
        return (half_width, start, half_width + depth, end)
    return (start, bay["plane"], end, bay["plane"] + depth)


def references_for(bay, half_width):
    low, high = bay["span"]
    if bay["side"] == "west":
        return [(-half_width, low), (-half_width, high)]
    if bay["side"] == "east":
        return [(half_width, high), (half_width, low)]
    return [(low, bay["plane"]), (high, bay["plane"])]


def validate_design(data):
    bays = data["bays"]
    expected = {"L1", "L2", "L3", "L4", "L5", "R1", "R2", "R3", "R4", "F1", "F2"}
    issues = []
    if len(bays) != len(expected) or {bay["id"] for bay in bays} != expected:
        issues.append("区画番号と区画数に重複または欠落があります。")
    if set(data["lighting"]) != expected | {"I1", "I2", "I3"}:
        issues.append("区画と照明表の行が一致しません。")

    half_width = data["common"]["halfWidth"]
    camera = data["reference"]
    errors = []
    fixture_ids = set()
    for bay in bays:
        name = bay["id"]
        width = bay["span"][1] - bay["span"][0]
        depth = bay["depth"]
        door_start, door_end, recess = bay["entry"]
        clear_width = bay["clearWidth"]
        r = clear_width / 2
        if not 0 <= door_start < door_end <= width + 1e-6 or door_end - door_start < clear_width - 1e-6:
            issues.append(f"{name}: 入口幅が店の有効通路幅を満たしません。")
        if not 0 < recess < depth or not 0 < bay["entryHeight"] < bay["ceiling"]:
            issues.append(f"{name}: 入口の引き込みまたは高さが不正です。")
        lights = bay["lights"]
        if len(lights) < 2 or len({light["id"] for light in lights}) != len(lights):
            issues.append(f"{name}: 代表照明に欠落または重複があります。")
        if any(not (0 <= light["u"] <= width and 0 <= light["d"] <= depth
                    and 0 < light["y"] <= bay["ceiling"]) for light in lights):
            issues.append(f"{name}: 代表照明が仕上がり空間の外にあります。")

        fixtures = bay["fixtures"]
        occupied = []
        for item in fixtures:
            id_ = item["id"]
            if id_ in fixture_ids:
                issues.append(f"{id_}: 什器番号が重複しています。")
            fixture_ids.add(id_)
            u, d, w, l = item["rect"]
            if min(u, d) < -1e-6 or min(w, l, item["height"]) <= 0 or u + w > width + 1e-6 or d + l > depth + 1e-6:
                issues.append(f"{id_}: 仕上がり平面を越えています。")
            if item["height"] > bay["ceiling"]:
                issues.append(f"{id_}: 天井高を越えています。")
            occupied.append((id_, rect(u, d, w, l), 0, item["height"]))

        for item in bay.get("mounts", []):
            id_ = item["id"]
            if id_ in fixture_ids:
                issues.append(f"{id_}: 什器番号が重複しています。")
            fixture_ids.add(id_)
            u, d, w, l = item["rect"]
            bottom, top = item["bottom"], item["top"]
            if min(u, d) < -1e-6 or min(w, l) <= 0 or u + w > width + 1e-6 or d + l > depth + 1e-6:
                issues.append(f"{id_}: 吊り材の平面位置が区画を越えています。")
            if not 0 <= bottom < top <= bay["ceiling"]:
                issues.append(f"{id_}: 吊り材の高さが不正です。")
            occupied.append((id_, rect(u, d, w, l), bottom, top))

        for (id_a, a, low_a, high_a), (id_b, b, low_b, high_b) in combinations(occupied, 2):
            if overlap(a, b) and min(high_a, high_b) - max(low_a, low_b) > 1e-6:
                issues.append(f"{id_a} と {id_b}: 什器が重なります。")

        route = bay["route"]
        if len(route) < 2 or abs(route[0][0] - (door_start + door_end) / 2) > 1e-6 or abs(route[0][1]) > 1e-6:
            issues.append(f"{name}: 主通路の起点が入口の中心にありません。")
        if not any(point[1] >= recess + r - 1e-6 for point in route):
            issues.append(f"{name}: 主通路が入口から店内まで達していません。")
        clearance = []
        for (u1, d1), (u2, d2) in pairwise(route):
            if abs(u1 - u2) > 1e-6 and abs(d1 - d2) > 1e-6:
                issues.append(f"{name}: 主通路は壁に沿う直交線とします。")
            elif abs(u1 - u2) < 1e-6:
                clearance.append((u1 - r, min(d1, d2), u1 + r, max(d1, d2)))
            else:
                clearance.append((min(u1, u2), d1 - r, max(u1, u2), d1 + r))
        for prev, at, next_ in zip(route, route[1:], route[2:]):
            if (abs(prev[0] - at[0]) < 1e-6) != (abs(at[0] - next_[0]) < 1e-6):
                clearance.append((at[0] - r, at[1] - r, at[0] + r, at[1] + r))

        for path in clearance:
            if path[0] < -1e-6 or path[2] > width + 1e-6 or path[3] > depth + 1e-6:
                issues.append(f"{name}: 有効通路幅が室外にはみ出しています。")
            if path[1] < recess and (path[0] < door_start - 1e-6 or path[2] > door_end + 1e-6):
                issues.append(f"{name}: 主通路が入口の袖壁と重なっています。")
            for id_, item, bottom, _ in occupied:
                if bottom < 2.10 and overlap(path, item):
                    issues.append(f"{name}: 主通路に {id_} が張り出しています。")

        facades = sorted(bay["frontage"], key=lambda f: f["u"][0])
        end = 0
        for segment in facades:
            a, b = segment["u"]
            if abs(a - end) > 1e-6 or a >= b:
                issues.append(f"{name}: 間口の区間に隙間または重複があります。")
            end = b
        if abs(end - width) > 1e-6:
            issues.append(f"{name}: 間口の幅と区画の幅が一致しません。")
        if not any(seg["kind"] in {"open", "door"} and
                   abs(seg["u"][0] - door_start) < 1e-6 and abs(seg["u"][1] - door_end) < 1e-6 for seg in facades):
            issues.append(f"{name}: 入口寸法が間口の開口に反映されていません。")

        for pier in data["common"]["pierRelocations"]:
            if pier["bay"] == name:
                u = pier["groundS"] - bay["span"][0]
                d = abs(pier["x"]) - half_width
                lower_pier = rect(u - .24, d - .21, .48, .42)
                if any(overlap(lower_pier, zone) for zone in clearance):
                    issues.append(f"{name}: 移設後の化粧柱が主通路に重なっています。")
                if any(low < 3.60 and overlap(lower_pier, item) for _, item, low, _ in occupied):
                    issues.append(f"{name}: 移設後の化粧柱が什器に重なっています。")

        for observed, (x, s) in zip(bay["photo"], references_for(bay, half_width)):
            if observed is not None:
                errors.append(abs(observed - (camera["cx"] + camera["f"] * x / s)))

    for a, b in combinations(bays, 2):
        if overlap(footprint(a, half_width), footprint(b, half_width)):
            issues.append(f"{a['id']} と {b['id']}: 区画が重なります。")
    common = data["common"]
    rear_bays = {bay["id"]: bay for bay in bays if bay["side"] == "rear"}
    reveals = common["rearReveals"]
    if {reveal["id"] for reveal in reveals} != set(rear_bays) or len(reveals) != len(rear_bays):
        issues.append("正面奥の区画と見通しの番号が一致しません。")
    for reveal in reveals:
        bay = rear_bays[reveal["id"]]
        x0, x1 = reveal["x"]
        s0, s1 = reveal["s"]
        if (not common["rearS"] <= s0 < s1 or s1 != bay["plane"] or
                x0 > bay["span"][0] or x1 < bay["span"][1] or
                reveal["floorStartS"] != common["rearS"] or reveal["floor"] != 0 or
                reveal["head"] < bay["entryHeight"]):
            issues.append(f"{reveal['id']}: 背面の見通しが店先に接続していません。")
    sofa_x, sofa_s, sofa_w, sofa_d = common["sofa"]
    tree_x, tree_s, tree_r = common["tree"]
    island_extents = []
    for item in data["islands"]:
        x, s = item["center"]
        w, d = item["size"]
        extent = rect(x - w / 2, s - d / 2, w, d)
        island_extents.append((item["id"], extent))
        if extent[0] < -half_width or extent[2] > half_width or extent[3] > common["rearS"]:
            issues.append(f"{item['id']}: 展示島が共用部の外にあります。")
        if overlap(extent, rect(sofa_x - sofa_w / 2, sofa_s - sofa_d / 2, sofa_w, sofa_d)):
            issues.append(f"{item['id']}: ソファに干渉します。")
        tree_dist = hypot(max(extent[0] - tree_x, tree_x - extent[2], 0),
                          max(extent[1] - tree_s, tree_s - extent[3], 0))
        if tree_dist < tree_r - 1e-6:
            issues.append(f"{item['id']}: 枝状照明の台に干渉します。")

    if {id_ for id_, _ in island_extents} != {"I1", "I2", "I3"} or len(island_extents) != 3:
        issues.append("展示島番号に重複または欠落があります。")
    for (id_a, a), (id_b, b) in combinations(island_extents, 2):
        clear = hypot(max(a[0] - b[2], b[0] - a[2], 0), max(a[1] - b[3], b[1] - a[3], 0))
        if clear < 1.2 - 1e-6:
            issues.append(f"{id_a} と {id_b}: 展示島間の有効幅が1.20 mを下回ります。")

    if len(errors) != 17 or max(errors) > 15:
        issues.append("較正に使う可視の開口端は17点、水平差の上限は15 pxです。")
    if issues:
        raise ValueError("\n".join(dict.fromkeys(issues)))
    return {
        "bays": len(bays),
        "fixtures": sum(len(b["fixtures"]) for b in bays),
        "mounts": sum(len(b.get("mounts", [])) for b in bays),
        "light_positions": sum(len(b["lights"]) for b in bays),
        "islands": len(island_extents),
        "photo_edges": len(errors),
        "projection_median_px": round(median(errors), 1),
        "projection_max_px": round(max(errors), 1),
        "minimum_route_m": min(b["clearWidth"] for b in bays),
    }


if __name__ == "__main__":
    from argparse import ArgumentParser
    import json
    from pathlib import Path

    parser = ArgumentParser(description=__doc__)
    parser.add_argument("design", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(validate_design(json.loads(args.design.read_text(encoding="utf-8"))), ensure_ascii=False))
    except (ValueError, KeyError) as exc:
        parser.exit(1, f"{exc}\n")
