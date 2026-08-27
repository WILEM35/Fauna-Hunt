"""How many people have downloaded Fauna Hunt from GitHub.

GitHub counts every download of a release file but never shows it on the
web page -- you have to ask its API, which this does. No login needed;
the repository is public.
"""

import json
import urllib.request

REPO = "WILEM35/Fauna-Hunt"


def main():
    request = urllib.request.Request(
        "https://api.github.com/repos/%s/releases" % REPO,
        headers={"User-Agent": "fauna-hunt", "Accept": "application/vnd.github+json"},
    )
    try:
        releases = json.load(urllib.request.urlopen(request, timeout=20))
    except Exception as err:
        print("Could not reach GitHub: %s" % err)
        return 1

    if not releases:
        print("No releases published yet.")
        return 0

    print()
    print("  FAUNA HUNT - downloads from GitHub")
    print("  " + "=" * 52)
    print()

    total = 0
    for release in releases:
        published = (release.get("published_at") or "")[:10]
        print("  %-12s published %s" % (release["tag_name"], published))
        assets = release.get("assets", [])
        if not assets:
            print("      (no file attached to this release)")
        for asset in assets:
            count = asset["download_count"]
            print("      %-30s %5d %s"
                  % (asset["name"], count, "download" if count == 1 else "downloads"))
            total += count
        print()

    print("  " + "-" * 52)
    print("  %d downloads in total" % total)
    print()
    print("  Counts every download, including your own and the odd bot.")
    print("  It does not tell you who, and it cannot tell one person")
    print("  downloading twice from two people downloading once.")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
