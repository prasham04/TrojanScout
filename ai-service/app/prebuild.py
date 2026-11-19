"""Run once at deploy time (see render.yaml) so a cold start only *loads* things instead of computing them:
downloads the ONNX embedding model and builds the listings search index from the committed data/listings.json.

    python -m app.prebuild
"""
import json
import time
from pathlib import Path

from app.config import settings
from app.listings.index import INDEX, warm
from app.listings.models import Listing


def main():
    t = time.time()
    warm()  # downloads/loads the embedding model (and reranker, if enabled)
    rows = json.loads((Path(settings.data_dir) / "listings.json").read_text()).get("listings", [])
    INDEX.build([Listing(**x) for x in rows])  # also saves to settings.index_dir
    print(f"prebuild: model ready, {len(rows)} listings indexed into {settings.index_dir} in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
