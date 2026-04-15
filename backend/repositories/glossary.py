from databases.postgres import db


LABEL_COLUMNS_SELECT = """
l.id,
l.user_id,
l.name,
l.color,
l.created_at,
l.updated_at
"""

LABEL_COLUMNS_RETURNING = """
id,
user_id,
name,
color,
created_at,
updated_at
"""

TERM_COLUMNS = """
t.id,
t.user_id,
t.term,
t.short_definition,
t.simple_definition,
t.professional_definition,
t.related_sources,
t.note,
t.related_terms,
t.created_at,
t.updated_at
"""


def _build_label_payload(row: dict) -> dict:
    return {
        "id": row["label_id"],
        "name": row["label_name"],
        "color": row["label_color"],
        "created_at": row["label_created_at"],
        "updated_at": row["label_updated_at"],
    }


def _build_term_payload(row: dict, labels_by_term_id: dict[int, list[dict]]) -> dict:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "term": row["term"],
        "short_definition": row["short_definition"],
        "simple_definition": row["simple_definition"],
        "professional_definition": row["professional_definition"],
        "related_sources": row["related_sources"],
        "note": row["note"],
        "related_terms": row["related_terms"] or [],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "labels": labels_by_term_id.get(row["id"], []),
    }


async def list_glossary_labels(user_id: int) -> list[dict]:
    query = f"""
        select {LABEL_COLUMNS_SELECT}
        from glossary_labels l
        where l.user_id = $1
        order by lower(l.name) asc, l.created_at asc
    """
    rows = await db.execute(query, user_id)
    return rows or []


async def list_glossary_labels_by_ids(user_id: int, label_ids: list[int]) -> list[dict]:
    if not label_ids:
        return []

    query = f"""
        select {LABEL_COLUMNS_SELECT}
        from glossary_labels l
        where l.user_id = $1
          and l.id = any($2::bigint[])
        order by lower(l.name) asc
    """
    rows = await db.execute(query, user_id, label_ids)
    return rows or []


async def get_glossary_label(user_id: int, label_id: int) -> dict | None:
    query = f"""
        select {LABEL_COLUMNS_SELECT}
        from glossary_labels l
        where l.user_id = $1
          and l.id = $2
    """
    rows = await db.execute(query, user_id, label_id)
    if not rows:
        return None
    return rows[0]


async def create_glossary_label(user_id: int, name: str, color: str) -> dict | None:
    duplicate_check_query = """
        select id
        from glossary_labels
        where user_id = $1
          and lower(name) = lower($2)
        limit 1
    """
    duplicate_rows = await db.execute(duplicate_check_query, user_id, name)
    if duplicate_rows:
        raise ValueError("Label already exists.")

    query = f"""
        insert into glossary_labels (user_id, name, color)
        values ($1, $2, $3)
        returning {LABEL_COLUMNS_RETURNING}
    """
    rows = await db.execute(query, user_id, name, color)
    if not rows:
        return None
    return rows[0]


async def update_glossary_label(user_id: int, label_id: int, name: str, color: str) -> dict | None:
    duplicate_check_query = """
        select id
        from glossary_labels
        where user_id = $1
          and lower(name) = lower($2)
          and id <> $3
        limit 1
    """
    duplicate_rows = await db.execute(duplicate_check_query, user_id, name, label_id)
    if duplicate_rows:
        raise ValueError("Label already exists.")

    query = f"""
        update glossary_labels l
        set
            name = $3,
            color = $4,
            updated_at = now()
        where l.user_id = $1
          and l.id = $2
        returning {LABEL_COLUMNS_RETURNING}
    """
    rows = await db.execute(query, user_id, label_id, name, color)
    if not rows:
        return None
    return rows[0]


async def delete_glossary_label(user_id: int, label_id: int) -> bool:
    query = """
        delete from glossary_labels
        where user_id = $1
          and id = $2
        returning id
    """
    rows = await db.execute(query, user_id, label_id)
    return bool(rows)


def _dedupe_ids(values: list[int]) -> list[int]:
    deduped: list[int] = []
    seen: set[int] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


async def _list_term_label_rows(user_id: int, term_ids: list[int] | None = None) -> list[dict]:
    base_query = """
        select
            tl.term_id,
            l.id as label_id,
            l.name as label_name,
            l.color as label_color,
            l.created_at as label_created_at,
            l.updated_at as label_updated_at
        from glossary_term_labels tl
        join glossary_labels l
          on l.id = tl.label_id
         and l.user_id = tl.user_id
        where tl.user_id = $1
    """

    if term_ids:
        query = f"""
            {base_query}
              and tl.term_id = any($2::bigint[])
            order by tl.term_id asc, lower(l.name) asc
        """
        rows = await db.execute(query, user_id, term_ids)
    else:
        query = f"""
            {base_query}
            order by tl.term_id asc, lower(l.name) asc
        """
        rows = await db.execute(query, user_id)

    return rows or []


def _group_labels_by_term_id(rows: list[dict]) -> dict[int, list[dict]]:
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        term_id = row["term_id"]
        grouped.setdefault(term_id, []).append(_build_label_payload(row))
    return grouped


async def _replace_term_labels(user_id: int, term_id: int, label_ids: list[int]) -> None:
    delete_query = """
        delete from glossary_term_labels
        where user_id = $1
          and term_id = $2
    """
    await db.execute(delete_query, user_id, term_id)

    deduped_label_ids = _dedupe_ids(label_ids)
    if not deduped_label_ids:
        return

    insert_query = """
        insert into glossary_term_labels (term_id, label_id, user_id)
        select $2, label_id, $1
        from unnest($3::bigint[]) as label_id
        on conflict (term_id, label_id) do nothing
        returning term_id
    """
    await db.execute(insert_query, user_id, term_id, deduped_label_ids)


async def list_glossary_terms(user_id: int) -> list[dict]:
    query = f"""
        select
            {TERM_COLUMNS}
        from glossary_terms t
        where t.user_id = $1
        order by t.updated_at desc, t.created_at desc
    """
    term_rows = await db.execute(query, user_id)
    if not term_rows:
        return []

    term_ids = [row["id"] for row in term_rows]
    label_rows = await _list_term_label_rows(user_id, term_ids)
    labels_by_term_id = _group_labels_by_term_id(label_rows)

    return [_build_term_payload(row, labels_by_term_id) for row in term_rows]


async def get_glossary_term(user_id: int, term_id: int) -> dict | None:
    query = f"""
        select
            {TERM_COLUMNS}
        from glossary_terms t
        where t.user_id = $1
          and t.id = $2
    """
    rows = await db.execute(query, user_id, term_id)
    if not rows:
        return None

    label_rows = await _list_term_label_rows(user_id, [term_id])
    labels_by_term_id = _group_labels_by_term_id(label_rows)
    return _build_term_payload(rows[0], labels_by_term_id)


async def create_glossary_term(
    user_id: int,
    term: str,
    short_definition: str,
    simple_definition: str,
    professional_definition: str,
    related_sources: str | None,
    note: str | None,
    related_terms: list[str],
    label_ids: list[int],
) -> dict | None:
    duplicate_check_query = """
        select id
        from glossary_terms
        where user_id = $1
          and lower(term) = lower($2)
        limit 1
    """
    duplicate_rows = await db.execute(duplicate_check_query, user_id, term)
    if duplicate_rows:
        raise ValueError("Term already exists.")

    query = """
        insert into glossary_terms (
            user_id,
            term,
            definition,
            notes,
            short_definition,
            simple_definition,
            professional_definition,
            related_sources,
            note,
            related_terms
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id
    """
    rows = await db.execute(
        query,
        user_id,
        term,
        professional_definition,
        note,
        short_definition,
        simple_definition,
        professional_definition,
        related_sources,
        note,
        related_terms,
    )
    if not rows:
        return None

    created_term_id = rows[0]["id"]
    await _replace_term_labels(user_id, created_term_id, label_ids)
    return await get_glossary_term(user_id, created_term_id)


async def update_glossary_term(
    user_id: int,
    term_id: int,
    term: str,
    short_definition: str,
    simple_definition: str,
    professional_definition: str,
    related_sources: str | None,
    note: str | None,
    related_terms: list[str],
    label_ids: list[int],
) -> dict | None:
    duplicate_check_query = """
        select id
        from glossary_terms
        where user_id = $1
          and lower(term) = lower($2)
          and id <> $3
        limit 1
    """
    duplicate_rows = await db.execute(duplicate_check_query, user_id, term, term_id)
    if duplicate_rows:
        raise ValueError("Term already exists.")

    query = """
        update glossary_terms
        set
            term = $3,
            definition = $4,
            notes = $5,
            short_definition = $6,
            simple_definition = $7,
            professional_definition = $8,
            related_sources = $9,
            note = $10,
            related_terms = $11,
            updated_at = now()
        where user_id = $1
          and id = $2
        returning id
    """
    rows = await db.execute(
        query,
        user_id,
        term_id,
        term,
        professional_definition,
        note,
        short_definition,
        simple_definition,
        professional_definition,
        related_sources,
        note,
        related_terms,
    )
    if not rows:
        return None

    await _replace_term_labels(user_id, term_id, label_ids)
    return await get_glossary_term(user_id, term_id)


async def delete_glossary_term(user_id: int, term_id: int) -> bool:
    query = """
        delete from glossary_terms
        where user_id = $1
          and id = $2
        returning id
    """
    rows = await db.execute(query, user_id, term_id)
    return bool(rows)
