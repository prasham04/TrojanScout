from app.config import settings
from app.listings.sources import appfolio, featured, rentcast, stuho, tripalink

# Each source: async fetch(client) -> list[Listing]. Add new adapters here.
ALL = {"stuho": stuho.fetch, "tripalink": tripalink.fetch, "mosaic": appfolio.fetch,
       "featured": featured.fetch, "rentcast": rentcast.fetch}


def enabled() -> dict:
    return {k: v for k, v in ALL.items() if k != "rentcast" or settings.rentcast_api_key}
