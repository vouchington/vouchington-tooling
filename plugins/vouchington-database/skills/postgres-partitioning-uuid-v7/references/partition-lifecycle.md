# Partition lifecycle

UUIDv7 ordering supports range bounds and index-friendly time windows. Generate bounds from time
instead of extracting timestamps in predicates; use a generated timestamp only when application
semantics require one. Partition on the range key that queries and retention actually constrain.

Create future ranges before writes need them and maintain a default partition only with an explicit
attachment plan. Before attaching a populated range, prove the default partition excludes that range
or move conflicting rows; otherwise attachment can scan and lock the default partition.

Every primary or unique constraint on a partitioned table must include its partition key. Verify
pruning with predicates on that key, including joins whose other side needs an equivalent range
condition. UUIDv7 values are time ordered, not a promise that independently generated identifiers
have a strict ordering relationship.
