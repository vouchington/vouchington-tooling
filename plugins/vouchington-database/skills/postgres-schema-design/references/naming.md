# Naming

Use full words in snake_case. Tables read as `<owner>_<thing>s`, with only the last word
plural: `account_payment_methods`, not `accounts_payments_methods`. Core entities may use one
word (`accounts`, `orders`, `invoices`) when local policy permits it. Enum names follow the same
plural convention. Choose a shorter full-word name when a base identifier would exceed 63 bytes.

Indexes use `idx_<table>__<suffix>`; a unique index may use `uq_`. The suffix describes its
purpose or keys. The table portion may abbreviate only when it expands unambiguously to the
indexed table: preserve every word, its order, and separators. Each shortened word keeps its
first letter and at least three letters in their original order; words of three or fewer letters
stay whole. `idx_ord_line_itms__invoice_id` can name an index on `order_line_items`.
Initialisms and dropped words cannot. All identifiers stay within 63 bytes.

Column names and types imply each other:

- `timestamptz` ends in `_at`; dates use `day` or `_on`.
- Booleans contain a predicate prefix `is_`, `has_`, `can_`, or `should_` at a word boundary.
- FK columns end in the target's final word, singular: `invoice_id` references `invoices`.
  Drop redundant owner words when the column's table already supplies them.
- A column referencing a natural key may use that key's name. A retained identity reference
  keeps the entity's name even though the retained table ends in `identities`.
- Reserve `_user_id` and actor `_by_id` for references to users or retained user identities.
  Adapt the actor convention to the repository's account model; never use an actor suffix for
  an unrelated FK or an opaque token.

Trigger functions use `fn_<verb>_<what>` with this closed verb list:
`reject` (raise on invalid writes), `update` (set the current row), `project` (derived state in
other rows), `create` (companion rows), `lock`, `register`, and `ensure` (retained identity).
Ordinary functions use a name that explains their return value.

Generic enforcement: `postgres-object-naming`, `postgres-column-naming`, and
`postgres-identifier-length` in `jonathanong/no-mistakes`. Check the installed rule's supported options before enabling it;
an upstream rule name does not establish that the installed release includes it.
