"""
apply_rarity.py -- rate every species by how hard it is to FIND, and group
subspecies under a headline animal.

The first rating was done by how obscure a name sounded, which made 39 of 107
species "rare" -- a third of the game -- while the African elephant, the most
sought-after animal in it, counted as common. This replaces that with a rating
based on how much of the world an animal actually occupies and whether you have
to go somewhere on purpose to find it.

Grouping matters as much as the rating: the sim ships seven brown bears, four
tigers, four giraffes and four arctic foxes. Listing those as separate species
makes the lifelist read like a taxonomy exercise. Grouped under a parent, the
first tiger is an event and the other three are a completionist's bonus.

Run after build_species_table.py; rewrites species.json in place.
"""

import json
import os
import sys
from collections import Counter

TIERS = {
    "everyday":  {"rank": 1, "points": 5,   "label": "everyday"},
    "common":    {"rank": 2, "points": 20,  "label": "common"},
    "regional":  {"rank": 3, "points": 60,  "label": "regional"},
    "rare":      {"rank": 4, "points": 200, "label": "rare"},
    "legendary": {"rank": 5, "points": 600, "label": "legendary"},
}

# root -> (tier, headline animal it belongs to)
RATING = {
    # --- everyday: farmland, almost anywhere -------------------------------
    "BTaurusPrimigenius": ("everyday", "Cattle"),
    "BTaurusIndicus":     ("everyday", "Cattle"),
    "OAriesAries":        ("everyday", "Sheep"),
    "CHircusHircus":      ("everyday", "Goat"),
    "ECaballus":          ("everyday", "Horse"),
    "LGlama":             ("everyday", "Llama"),
    "VPacos":             ("everyday", "Alpaca"),
    "BBubalis":           ("everyday", "Water Buffalo"),
    "BBBubalis":          ("everyday", "Water Buffalo"),

    # --- common: widespread, but you must be on the right continent --------
    "EQuagga":               ("common", "Zebra"),
    "CTaurinusTaurinus":     ("common", "Wildebeest"),
    "EThomsonii":            ("common", "Thomson's Gazelle"),
    "CCrocuta":              ("common", "Spotted Hyena"),
    "PAfricanus":            ("common", "Warthog"),
    "SCaffer":               ("common", "African Buffalo"),
    "SCamelus":              ("common", "Ostrich"),
    "HAmphibius":            ("common", "Hippopotamus"),
    "CDromedarius":          ("common", "Camel"),
    "GTippelskirchi":        ("common", "Giraffe"),
    "GReticulata":           ("common", "Giraffe"),
    "AAlces":                ("common", "Moose"),
    "OAriesMusimon":         ("common", "Mouflon"),
    "CIbex":                 ("common", "Alpine Ibex"),
    "OHemionus":             ("common", "Mule Deer"),
    "CElaphusCanadensis":    ("common", "Elk"),
    "BBison":                ("common", "Bison"),
    "AAmericanus":           ("common", "Pronghorn"),
    "UAmericanus":           ("common", "American Black Bear"),
    "BlackBear":             ("common", "American Black Bear"),
    "OAmericanus":           ("common", "Mountain Goat"),
    "OCanadensis":           ("common", "Bighorn Sheep"),
    "CNippon":               ("common", "Sika Deer"),
    "BGrunniens":            ("common", "Yak"),
    "MRufus":                ("common", "Red Kangaroo"),
    "HHydrochaeris":         ("common", "Capybara"),
    "RTarandusGroenlandicus":("common", "Caribou"),

    # --- regional: right country, right habitat ----------------------------
    "LAfricana":             ("regional", "African Elephant"),
    "GAngolan":              ("regional", "Giraffe"),
    "GAntiquorum":           ("regional", "Giraffe"),
    "GCamelopardalis":       ("regional", "Giraffe"),
    "GGiraffa":              ("regional", "Giraffe"),
    "GPeralta":              ("regional", "Giraffe"),
    "GCamelopardalisPeralta":("regional", "Giraffe"),
    "PLeoMelanochaita":      ("regional", "Lion"),
    "AJubatusJubatus":       ("regional", "Cheetah"),
    "CSimum":                ("regional", "Rhinoceros"),
    "HNiger":                ("regional", "Sable Antelope"),
    "ALervia":               ("regional", "Barbary Sheep"),
    "CTaurinusGnou":         ("regional", "Wildebeest"),
    "CTaurinusAlbojubatus":  ("regional", "Wildebeest"),
    "CTaurinusJohnstoni":    ("regional", "Wildebeest"),
    "CTaurinusMearnsi":      ("regional", "Wildebeest"),
    "PTroglodytesVerus":     ("regional", "Chimpanzee"),
    "CSuchus":               ("regional", "Crocodile"),
    "CPalustris":            ("regional", "Crocodile"),
    "CPorosus":              ("regional", "Crocodile"),
    "EMaximus":              ("regional", "Asian Elephant"),
    "PTigris":               ("regional", "Tiger"),
    "PTigrisTigris":         ("regional", "Tiger"),
    "UThibetanus":           ("regional", "Asian Black Bear"),
    "CBactrianus":           ("regional", "Camel"),
    "BJavanicus":            ("regional", "Banteng"),
    "BFrontalis":            ("regional", "Gayal"),
    "UArctosArctos":         ("regional", "Brown Bear"),
    "UArctosHorribilis":     ("regional", "Brown Bear"),
    "GrizzlyBear":           ("regional", "Brown Bear"),
    "CLupusLupus":           ("regional", "Wolf"),
    "BBonasus":              ("regional", "Bison"),
    "VLagopus":              ("regional", "Arctic Fox"),
    "ODalliDalli":           ("regional", "Dall Sheep"),
    "MTridactyla":           ("regional", "Giant Anteater"),

    # --- rare: narrow range, you go there on purpose -----------------------
    "OAfer":                 ("rare", "Aardvark"),
    "LCyclotis":             ("rare", "African Elephant"),
    "TEurycerus":            ("rare", "Bongo"),
    "PAethiopicus":          ("rare", "Warthog"),
    "SCafferNanus":          ("rare", "African Buffalo"),
    "SCafferBrachyceros":    ("rare", "African Buffalo"),
    "EGrevyi":               ("rare", "Zebra"),
    "EHartmannae":           ("rare", "Zebra"),
    "AJubatusSoemmeringii":  ("rare", "Cheetah"),
    "AJubatusHecki":         ("rare", "Cheetah"),
    "PLeoLeo":               ("rare", "Lion"),
    "PLeoPersica":           ("rare", "Lion"),
    "PTigrisSondaica":       ("rare", "Tiger"),
    "HMalayanus":            ("rare", "Sun Bear"),
    "UArctosCollaris":       ("rare", "Brown Bear"),
    "UArctosIsabellinus":    ("rare", "Brown Bear"),
    "UArctosLasiotus":       ("rare", "Brown Bear"),
    "SyrianBear":            ("rare", "Brown Bear"),
    "UMaritimus":            ("rare", "Polar Bear"),
    "CLupusArctos":          ("rare", "Wolf"),
    "CLupusAlbus":           ("rare", "Wolf"),
    "VLagopusBeringensis":   ("rare", "Arctic Fox"),
    "VLagopusFuliginosus":   ("rare", "Arctic Fox"),
    "VLagopusPribilofensis": ("rare", "Arctic Fox"),
    "OCanadensisNelsoni":    ("rare", "Bighorn Sheep"),
    "ODalliStonei":          ("rare", "Dall Sheep"),
    "CCanadensisNannodes":   ("rare", "Elk"),
    "HIsthmius":             ("rare", "Capybara"),

    # --- legendary: a handful of places on Earth ---------------------------
    "AMelanoleuca":  ("legendary", "Giant Panda"),
    "PUncia":        ("legendary", "Snow Leopard"),
    "PTigrisAltaica":("legendary", "Tiger"),
    "EPrzewalskii":  ("legendary", "Przewalski's Horse"),
    "PPaniscus":     ("legendary", "Bonobo"),
    "NLarvatus":     ("legendary", "Proboscis Monkey"),
    "HumpbackWhale": ("legendary", "Humpback Whale"),
    "Orca":          ("legendary", "Orca"),
}


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.normpath(os.path.join(
        here, os.pardir, "PackageSources", "Copys", "fauna-hunt",
        "Service", "species.json"))

    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    species = data["species"]

    missing = [r for r in species if r not in RATING]
    extra = [r for r in RATING if r not in species]
    if missing or extra:
        print("Rating does not match the species table.")
        for r in missing:
            print("  unrated: %s (%s)" % (r, species[r]["common"]))
        for r in extra:
            print("  rated but not present: %s" % r)
        return 1

    for root, entry in species.items():
        tier, group = RATING[root]
        entry["tier"] = tier
        entry["points"] = TIERS[tier]["points"]
        entry["rank"] = TIERS[tier]["rank"]
        entry["group"] = group
        # The old 1-4 rarity is gone; leave nothing behind to read by accident.
        entry.pop("rarity", None)

    data["tiers"] = TIERS
    groups = {}
    for root, entry in species.items():
        groups.setdefault(entry["group"], []).append(root)
    data["groups"] = {g: sorted(v) for g, v in sorted(groups.items())}

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)

    counts = Counter(e["tier"] for e in species.values())
    print("%d species in %d headline animals\n" % (len(species), len(groups)))
    print("%-11s %6s %8s" % ("TIER", "COUNT", "POINTS"))
    for tier in ("everyday", "common", "regional", "rare", "legendary"):
        print("%-11s %6d %8d" % (tier, counts[tier], TIERS[tier]["points"]))

    multi = {g: v for g, v in groups.items() if len(v) > 1}
    print("\n%d animals have variants:" % len(multi))
    for g in sorted(multi, key=lambda g: -len(multi[g])):
        print("   %-22s %d" % (g, len(multi[g])))
    print("\nAlert fires for rare + legendary: %d of %d species"
          % (counts["rare"] + counts["legendary"], len(species)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
