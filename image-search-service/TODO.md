# TODOs for Image Search Service

## Add direct to getty-proxy auth

Right now we are using our proxy service to make getty requests, this is nice for dev, but doesn't make sense for prod

Low priority

## Generate an alt tag for each image

This could help us create accessible sites without additional costs/time

## Implement Qdrant-first search with filters

Currently filters are ignored and we always query Getty first. The intended flow should be:

1. Query Qdrant first with filters applied
2. Only query Getty if we didn't get enough results from the cache

This reduces Getty API calls and makes better use of the vector cache. Filters should be enforced via Qdrant search, not post-filtering Getty candidates.

## Implement relevance sorting based on Qdrant scores

Use Qdrant similarity scores to sort search results by relevance. Currently results are returned in the order received from Getty/Qdrant without considering semantic relevance to the query.
