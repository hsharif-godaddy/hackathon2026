from __future__ import annotations

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from openai import OpenAI

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


def prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def load_cache(path: Path) -> dict[str, list[float]]:
    tmp = path.with_suffix(".tmp")
    for candidate in (path, tmp):
        if not candidate.exists():
            continue
        try:
            with open(candidate, encoding="utf-8") as f:
                data = json.load(f)
            if candidate == tmp:
                print(
                    f"WARNING: Recovered cache from incomplete write ({tmp.name}), promoting to main cache."
                )
                tmp.replace(path)
            return data
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_cache(path: Path, cache: dict[str, list[float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f)
    tmp.replace(path)


def fetch_embeddings(
    prompts: list[str],
    client: OpenAI,
    cache: dict[str, list[float]],
    *,
    cache_path: Path | None = None,
    model: str = DEFAULT_EMBEDDING_MODEL,
    batch_size: int = 100,
    concurrency: int = 8,
) -> list[list[float]]:
    """Resolve embeddings from cache and OpenAI; optional atomic disk cache after each batch."""
    results: list[list[float] | None] = [None] * len(prompts)
    to_fetch: list[tuple[int, str]] = []

    for i, prompt in enumerate(prompts):
        key = prompt_hash(prompt)
        if key in cache:
            results[i] = cache[key]
        else:
            to_fetch.append((i, prompt))

    if not to_fetch:
        print(f"All {len(prompts)} embeddings loaded from cache.")
        return [r for r in results]  # type: ignore[return-value]

    print(f"Fetching {len(to_fetch)} embeddings from OpenAI (cached: {len(prompts) - len(to_fetch)})...")
    total_batches = (len(to_fetch) + batch_size - 1) // batch_size
    batches = [to_fetch[s : s + batch_size] for s in range(0, len(to_fetch), batch_size)]

    cache_lock = threading.Lock()
    completed = [0]

    def fetch_batch(batch: list[tuple[int, str]]) -> None:
        indices, texts = zip(*batch)
        response = client.embeddings.create(model=model, input=list(texts))
        with cache_lock:
            for emb_obj in response.data:
                j = emb_obj.index
                idx = indices[j]
                embedding = emb_obj.embedding
                results[idx] = embedding
                cache[prompt_hash(prompts[idx])] = embedding
            completed[0] += 1
            print(f"  Batch {completed[0]}/{total_batches} done ({len(texts)} prompts)...")
            if cache_path is not None:
                save_cache(cache_path, cache)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(fetch_batch, batch): batch for batch in batches}
        for future in as_completed(futures):
            future.result()

    missing = [i for i, r in enumerate(results) if r is None]
    if missing:
        raise RuntimeError(f"Missing embeddings for {len(missing)} prompts at indices: {missing[:5]}...")
    return [r for r in results]  # type: ignore[return-value]
