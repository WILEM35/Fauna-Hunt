"""
build_species_table.py -- turn a raw catalogue dump into the game's species table.

Reads the newest catalog-*.json produced by species_catalog.py, groups the
~1000 raw titles into species, attaches human names and game attributes, and
writes species.json for the panel to consume.

Raw titles look like "PTigrisAltaicaFemaleVariation2": a genus initial plus
species (and often subspecies), then sex, then a variation index. Everything
after the species is cosmetic as far as the hunt is concerned.

Usage:
    python build_species_table.py
"""

import json
import glob
import os
import re
import sys
from collections import defaultdict

# ---------------------------------------------------------------- the map

# root -> (common name, scientific name, size, rarity, region)
#
# size:   huge large medium small     -- drives the "size class" hint
# rarity: 1 domestic, 2 common wild, 3 regional, 4 rare subspecies
#         -- drives scoring
SPECIES = {
    # --- bovids and cattle ---
    "BTaurusPrimigenius": ("Cattle", "Bos taurus primigenius", "large", 1, "Global"),
    "BTaurusIndicus": ("Zebu", "Bos taurus indicus", "large", 2, "Asia"),
    "BFrontalis": ("Gayal", "Bos frontalis", "large", 3, "Asia"),
    "BGrunniens": ("Yak", "Bos grunniens", "large", 3, "Asia"),
    "BJavanicus": ("Banteng", "Bos javanicus", "large", 3, "Asia"),
    "BBison": ("American Bison", "Bison bison", "huge", 2, "N.America"),
    "BBonasus": ("European Bison", "Bison bonasus", "huge", 3, "Europe"),
    "BBubalis": ("Water Buffalo", "Bubalus bubalis", "large", 2, "Asia"),
    "BBBubalis": ("Water Buffalo", "Bubalus bubalis", "large", 2, "Asia"),
    "SCaffer": ("African Buffalo", "Syncerus caffer", "large", 2, "Africa"),
    "SCafferBrachyceros": ("West African Buffalo", "Syncerus caffer brachyceros",
                           "large", 4, "Africa"),
    "SCafferNanus": ("Forest Buffalo", "Syncerus caffer nanus", "large", 4, "Africa"),

    # --- sheep and goats ---
    "OAriesAries": ("Sheep", "Ovis aries aries", "medium", 1, "Global"),
    "OAriesMusimon": ("Mouflon", "Ovis aries musimon", "medium", 3, "Europe"),
    "OCanadensis": ("Bighorn Sheep", "Ovis canadensis", "medium", 2, "N.America"),
    "OCanadensisNelsoni": ("Desert Bighorn", "Ovis canadensis nelsoni",
                           "medium", 4, "N.America"),
    "ODalliDalli": ("Dall Sheep", "Ovis dalli dalli", "medium", 3, "N.America"),
    "ODalliStonei": ("Stone's Sheep", "Ovis dalli stonei", "medium", 4, "N.America"),
    "CHircusHircus": ("Goat", "Capra hircus hircus", "medium", 1, "Global"),
    "CIbex": ("Alpine Ibex", "Capra ibex", "medium", 3, "Europe"),
    "ALervia": ("Barbary Sheep", "Ammotragus lervia", "medium", 3, "Africa"),
    "OAmericanus": ("Mountain Goat", "Oreamnos americanus", "medium", 2, "N.America"),

    # --- deer family ---
    "AAlces": ("Moose", "Alces alces", "large", 2, "Europe"),
    "CElaphusCanadensis": ("Elk", "Cervus elaphus canadensis", "large", 2, "N.America"),
    "CCanadensisNannodes": ("Tule Elk", "Cervus canadensis nannodes",
                            "large", 4, "N.America"),
    "CNippon": ("Sika Deer", "Cervus nippon", "medium", 2, "Asia"),
    "OHemionus": ("Mule Deer", "Odocoileus hemionus", "medium", 2, "N.America"),
    "RTarandusGroenlandicus": ("Caribou", "Rangifer tarandus groenlandicus",
                               "medium", 3, "Arctic"),

    # --- antelope and wildebeest ---
    "AAmericanus": ("Pronghorn", "Antilocapra americana", "medium", 2, "N.America"),
    "EThomsonii": ("Thomson's Gazelle", "Eudorcas thomsonii", "medium", 2, "Africa"),
    "HNiger": ("Sable Antelope", "Hippotragus niger", "medium", 3, "Africa"),
    "TEurycerus": ("Bongo", "Tragelaphus eurycerus", "medium", 4, "Africa"),
    "CTaurinusTaurinus": ("Blue Wildebeest", "Connochaetes taurinus taurinus",
                          "large", 2, "Africa"),
    "CTaurinusGnou": ("Black Wildebeest", "Connochaetes gnou", "large", 3, "Africa"),
    "CTaurinusAlbojubatus": ("E. White-bearded Wildebeest",
                             "Connochaetes taurinus albojubatus", "large", 4, "Africa"),
    "CTaurinusJohnstoni": ("Nyassa Wildebeest", "Connochaetes taurinus johnstoni",
                           "large", 4, "Africa"),
    "CTaurinusMearnsi": ("W. White-bearded Wildebeest",
                         "Connochaetes taurinus mearnsi", "large", 4, "Africa"),

    # --- horses and zebra ---
    "ECaballus": ("Horse", "Equus caballus", "large", 1, "Global"),
    "EPrzewalskii": ("Przewalski's Horse", "Equus przewalskii", "large", 4, "Asia"),
    "EQuagga": ("Plains Zebra", "Equus quagga", "large", 2, "Africa"),
    "EGrevyi": ("Grevy's Zebra", "Equus grevyi", "large", 3, "Africa"),
    "EHartmannae": ("Hartmann's Mountain Zebra", "Equus zebra hartmannae",
                    "large", 4, "Africa"),

    # --- camelids ---
    "CDromedarius": ("Dromedary Camel", "Camelus dromedarius", "large", 2, "Africa"),
    "CBactrianus": ("Bactrian Camel", "Camelus bactrianus", "large", 3, "Asia"),
    "LGlama": ("Llama", "Lama glama", "medium", 2, "S.America"),
    "VPacos": ("Alpaca", "Vicugna pacos", "medium", 2, "S.America"),

    # --- elephants, giraffes, hippo, rhino ---
    "LAfricana": ("African Bush Elephant", "Loxodonta africana", "huge", 2, "Africa"),
    "LCyclotis": ("African Forest Elephant", "Loxodonta cyclotis", "huge", 4, "Africa"),
    "EMaximus": ("Asian Elephant", "Elephas maximus", "huge", 3, "Asia"),
    "GCamelopardalis": ("Nubian Giraffe", "Giraffa camelopardalis", "huge", 3, "Africa"),
    "GGiraffa": ("South African Giraffe", "Giraffa giraffa", "huge", 3, "Africa"),
    "GReticulata": ("Reticulated Giraffe", "Giraffa reticulata", "huge", 3, "Africa"),
    "GTippelskirchi": ("Masai Giraffe", "Giraffa tippelskirchi", "huge", 3, "Africa"),
    "GAngolan": ("Angolan Giraffe", "Giraffa giraffa angolensis", "huge", 4, "Africa"),
    "GAntiquorum": ("Kordofan Giraffe", "Giraffa camelopardalis antiquorum",
                    "huge", 4, "Africa"),
    "GPeralta": ("West African Giraffe", "Giraffa camelopardalis peralta",
                 "huge", 4, "Africa"),
    "GCamelopardalisPeralta": ("West African Giraffe",
                               "Giraffa camelopardalis peralta", "huge", 4, "Africa"),
    "HAmphibius": ("Hippopotamus", "Hippopotamus amphibius", "huge", 2, "Africa"),
    "CSimum": ("White Rhinoceros", "Ceratotherium simum", "huge", 3, "Africa"),

    # --- big cats ---
    "PLeoLeo": ("Northern Lion", "Panthera leo leo", "large", 3, "Africa"),
    "PLeoMelanochaita": ("Southern Lion", "Panthera leo melanochaita",
                         "large", 2, "Africa"),
    "PLeoPersica": ("Asiatic Lion", "Panthera leo persica", "large", 4, "Asia"),
    "PTigris": ("Tiger", "Panthera tigris", "large", 3, "Asia"),
    "PTigrisTigris": ("Bengal Tiger", "Panthera tigris tigris", "large", 3, "Asia"),
    "PTigrisAltaica": ("Siberian Tiger", "Panthera tigris altaica", "large", 4, "Asia"),
    "PTigrisSondaica": ("Sunda Tiger", "Panthera tigris sondaica", "large", 4, "Asia"),
    "PUncia": ("Snow Leopard", "Panthera uncia", "medium", 4, "Asia"),
    "AJubatusJubatus": ("Cheetah", "Acinonyx jubatus jubatus", "medium", 3, "Africa"),
    "AJubatusHecki": ("NW African Cheetah", "Acinonyx jubatus hecki",
                      "medium", 4, "Africa"),
    "AJubatusSoemmeringii": ("NE African Cheetah", "Acinonyx jubatus soemmeringii",
                             "medium", 4, "Africa"),
    "CCrocuta": ("Spotted Hyena", "Crocuta crocuta", "medium", 2, "Africa"),

    # --- bears ---
    "UAmericanus": ("American Black Bear", "Ursus americanus", "large", 2, "N.America"),
    "UArctosHorribilis": ("Grizzly Bear", "Ursus arctos horribilis",
                          "large", 2, "N.America"),
    "UArctosArctos": ("Eurasian Brown Bear", "Ursus arctos arctos", "large", 3, "Europe"),
    "UArctosCollaris": ("E. Siberian Brown Bear", "Ursus arctos collaris",
                        "large", 4, "Asia"),
    "UArctosIsabellinus": ("Himalayan Brown Bear", "Ursus arctos isabellinus",
                           "large", 4, "Asia"),
    "UArctosLasiotus": ("Ussuri Brown Bear", "Ursus arctos lasiotus", "large", 4, "Asia"),
    "UMaritimus": ("Polar Bear", "Ursus maritimus", "large", 3, "Arctic"),
    "UThibetanus": ("Asian Black Bear", "Ursus thibetanus", "large", 3, "Asia"),
    "HMalayanus": ("Sun Bear", "Helarctos malayanus", "medium", 4, "Asia"),
    "AMelanoleuca": ("Giant Panda", "Ailuropoda melanoleuca", "large", 4, "Asia"),

    # --- canids and foxes ---
    "CLupusLupus": ("Eurasian Wolf", "Canis lupus lupus", "medium", 3, "Europe"),
    "CLupusArctos": ("Arctic Wolf", "Canis lupus arctos", "medium", 4, "Arctic"),
    "CLupusAlbus": ("Tundra Wolf", "Canis lupus albus", "medium", 4, "Arctic"),
    "VLagopus": ("Arctic Fox", "Vulpes lagopus", "small", 3, "Arctic"),
    "VLagopusBeringensis": ("Bering Arctic Fox", "Vulpes lagopus beringensis",
                            "small", 4, "Arctic"),
    "VLagopusFuliginosus": ("Iceland Arctic Fox", "Vulpes lagopus fuliginosus",
                            "small", 4, "Arctic"),
    "VLagopusPribilofensis": ("Pribilof Arctic Fox", "Vulpes lagopus pribilofensis",
                              "small", 4, "Arctic"),

    # --- primates ---
    "PTroglodytesVerus": ("Western Chimpanzee", "Pan troglodytes verus",
                          "medium", 3, "Africa"),
    "PPaniscus": ("Bonobo", "Pan paniscus", "medium", 4, "Africa"),
    "NLarvatus": ("Proboscis Monkey", "Nasalis larvatus", "small", 4, "Asia"),

    # --- crocodilians ---
    "CPorosus": ("Saltwater Crocodile", "Crocodylus porosus", "large", 3, "Australia"),
    "CPalustris": ("Mugger Crocodile", "Crocodylus palustris", "large", 4, "Asia"),
    "CSuchus": ("West African Crocodile", "Crocodylus suchus", "large", 4, "Africa"),

    # --- odds and ends ---
    "PAfricanus": ("Common Warthog", "Phacochoerus africanus", "medium", 2, "Africa"),
    "PAethiopicus": ("Desert Warthog", "Phacochoerus aethiopicus", "medium", 4, "Africa"),
    "OAfer": ("Aardvark", "Orycteropus afer", "medium", 4, "Africa"),
    "MTridactyla": ("Giant Anteater", "Myrmecophaga tridactyla", "medium", 3, "S.America"),
    "MRufus": ("Red Kangaroo", "Macropus rufus", "medium", 2, "Australia"),
    "HHydrochaeris": ("Capybara", "Hydrochoerus hydrochaeris", "small", 3, "S.America"),
    "HIsthmius": ("Lesser Capybara", "Hydrochoerus isthmius", "small", 4, "S.America"),
    "SCamelus": ("Ostrich", "Struthio camelus", "large", 2, "Africa"),
}

# Marine mammals arrive as single fixed titles rather than the binomial scheme.
SINGLETONS = {
    "HumpbackWhale": ("Humpback Whale", "Megaptera novaeangliae", "huge", 4, "Ocean"),
    "Orca": ("Orca", "Orcinus orca", "huge", 4, "Ocean"),
    "BlackBear": ("Black Bear", "Ursus americanus", "large", 2, "N.America"),
    "GrizzlyBear": ("Grizzly Bear", "Ursus arctos horribilis", "large", 2, "N.America"),
    "SyrianBear": ("Syrian Brown Bear", "Ursus arctos syriacus", "large", 4, "Asia"),
}

# Returned by the ANIMAL query but not wildlife. Excluded from the hunt.
EXCLUDE_EXACT = {"AnimalError"}
EXCLUDE_PREFIX = (
    "ahqw ",            # addon: walking people
    "ahqm ",            # addon: riders, wheelchair users
    "ASOBO_Demo",       # Stranger Things crossover
    "JW_",              # Jurassic World crossover
    "GALLIMIMUS",       # dinosaur
    "ESD_Anm_",         # addon animals, duplicate stock species
    "EGH2_",            # addon horses
)
# Addon livestock reskins -- real animals, but duplicates of stock species.
EXCLUDE_SUFFIX = ("_Cow", "_Llama")

SPLIT_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])")
SUFFIX = re.compile(r"(Male|Female|Juvenile)(Variation\d+)*$")


def species_root(title):
    return SUFFIX.sub("", title)


def is_excluded(title):
    if title in EXCLUDE_EXACT:
        return True
    if title.startswith(EXCLUDE_PREFIX):
        return True
    return title.endswith(EXCLUDE_SUFFIX)


def parse_variant(title, root):
    """Pull sex and variation index off a raw title."""
    tail = title[len(root):]
    sex = "unknown"
    for candidate in ("Juvenile", "Female", "Male"):
        if tail.startswith(candidate):
            sex = candidate.lower()
            break
    match = re.search(r"Variation(\d+)", tail)
    return sex, int(match.group(1)) if match else 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    catalogs = sorted(glob.glob(os.path.join(here, "catalog-*.json")))
    if not catalogs:
        print("No catalog-*.json found. Run species_catalog.py first.")
        return 1

    source = catalogs[-1]
    with open(source, encoding="utf-8") as handle:
        data = json.load(handle)
    titles = data.get("animals", {}).get("titles", [])
    print("Reading %s (%d raw titles)" % (os.path.basename(source), len(titles)))

    grouped = defaultdict(list)
    excluded = []
    for title in titles:
        if is_excluded(title):
            excluded.append(title)
            continue
        grouped[species_root(title)].append(title)

    table = {}
    unmapped = []
    for root, variants in sorted(grouped.items()):
        entry = SPECIES.get(root) or SINGLETONS.get(root)
        if entry is None:
            unmapped.append((root, len(variants)))
            continue
        common, scientific, size, rarity, region = entry
        table[root] = {
            "common": common,
            "scientific": scientific,
            "size": size,
            "rarity": rarity,
            "region": region,
            "titles": sorted(variants),
            "variants": [
                dict(zip(("title", "sex", "variation"),
                         (t,) + parse_variant(t, root)))
                for t in sorted(variants)
            ],
        }

    # Reverse index: raw title -> species root, which is what the panel needs
    # at runtime to turn a SimConnect TITLE into something a human can read.
    lookup = {}
    for root, entry in table.items():
        for title in entry["titles"]:
            lookup[title] = root

    # Written straight into the service folder, so the shipped package
    # always carries the table the panel and service both read.
    out = os.path.normpath(os.path.join(here, os.pardir, "PackageSources",
                                        "Copys", "fauna-hunt", "Service",
                                        "species.json"))
    with open(out, "w", encoding="utf-8") as handle:
        json.dump({
            "source": os.path.basename(source),
            "species": table,
            "title_to_species": lookup,
            "excluded_titles": sorted(excluded),
        }, handle, indent=2)

    by_region = defaultdict(int)
    by_rarity = defaultdict(int)
    for entry in table.values():
        by_region[entry["region"]] += 1
        by_rarity[entry["rarity"]] += 1

    print("\n%d species mapped, from %d titles" % (len(table), len(lookup)))
    print("%d titles excluded (people, dinosaurs, addon reskins)" % len(excluded))

    print("\nBy region:")
    for region in sorted(by_region, key=lambda r: -by_region[r]):
        print("   %-12s %d" % (region, by_region[region]))

    print("\nBy rarity (1 domestic .. 4 rare subspecies):")
    for rarity in sorted(by_rarity):
        print("   %d  %d species" % (rarity, by_rarity[rarity]))

    if unmapped:
        print("\n! %d root(s) with no entry in the table:" % len(unmapped))
        for root, count in unmapped:
            print("   %-34s %d variant(s)" % (root, count))

    print("\nWritten to %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
