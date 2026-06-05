import { makeEntityId, canonicalizeName } from "./entity-id";

/** Raw entity as extracted by the LLM (no system ID yet). Extra attrs are carried through. */
export interface RawEntity {
  name: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface NormalizedEntity {
  id: string;
  name: string;
  aliases: string[];
  [key: string]: unknown;
}

export interface EntityNormalizationResult {
  entities: NormalizedEntity[];
  /** canonical name/alias -> assigned id (for remapping references downstream) */
  nameToId: Record<string, string>;
  /** legal id + display name list, injected into plan/generate prompts (anti-hallucination) */
  catalog: { id: string; name: string }[];
}

/**
 * Dedup entities by canonical name (or any alias), assign deterministic IDs, and
 * produce the legal-ID catalog. The LLM proposes names/attrs; the system owns IDs (spec §6.2).
 */
export function normalizeEntities(prefix: "char" | "loc", raw: RawEntity[]): EntityNormalizationResult {
  const idByCanon = new Map<string, string>();      // canonical name/alias -> id
  const canonById = new Map<string, string>();      // id -> primary canonical name (collision check)
  const entityById = new Map<string, NormalizedEntity>();

  for (const e of raw) {
    const canon = canonicalizeName(e.name);
    const aliasCanons = (e.aliases ?? []).map(canonicalizeName);

    // 1. Find an existing id by name or any alias.
    let id = idByCanon.get(canon);
    if (!id) {
      for (const a of aliasCanons) {
        const found = idByCanon.get(a);
        if (found) { id = found; break; }
      }
    }

    // 2. Allocate a new id, disambiguating the rare hash collision.
    if (!id) {
      const base = makeEntityId(prefix, e.name);
      id = base;
      let n = 2;
      while (canonById.has(id) && canonById.get(id) !== canon) {
        id = `${base}_${n++}`;
      }
      canonById.set(id, canon);
    }

    // 3. Register name + aliases -> id.
    idByCanon.set(canon, id);
    for (const a of aliasCanons) idByCanon.set(a, id);

    // 4. Insert or merge the entity.
    const prev = entityById.get(id);
    if (prev) {
      entityById.set(id, {
        ...prev,
        ...e,
        id,
        name: prev.name,
        aliases: Array.from(new Set([...prev.aliases, ...(e.aliases ?? [])])),
      });
    } else {
      entityById.set(id, { ...e, id, name: e.name, aliases: e.aliases ?? [] });
    }
  }

  const entities = [...entityById.values()];
  return {
    entities,
    nameToId: Object.fromEntries(idByCanon),
    catalog: entities.map((e) => ({ id: e.id, name: e.name })),
  };
}
