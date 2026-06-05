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
  /** canonical name/alias -> assigned id (first owner wins on conflict), for reference remapping */
  nameToId: Record<string, string>;
  /** legal id + display name list, injected into plan/generate prompts (anti-hallucination) */
  catalog: { id: string; name: string }[];
}

/**
 * Dedup entities and assign deterministic IDs (spec §6.2).
 *
 * Identity is keyed on the canonical NAME: an entity merges into an existing one only
 * when its name — or one of its aliases — equals an existing entity's canonical NAME.
 * Aliases that two entities merely share (and that are not anyone's name) do NOT cause a
 * merge, so distinct characters who share a nickname (e.g. "老大") stay separate.
 *
 * On a merge, earlier attributes win and later records only fill gaps (must not lose
 * earlier attributes). `nameToId` maps names and aliases to ids with first-owner-wins,
 * so a shared alias never silently re-points to a different entity. `catalog` is the
 * legal-ID list for prompts.
 */
export function normalizeEntities(prefix: "char" | "loc", raw: RawEntity[]): EntityNormalizationResult {
  const idByName = new Map<string, string>();    // canonical NAME -> id (the only merge key)
  const canonById = new Map<string, string>();   // id -> primary canonical name (collision check)
  const entityById = new Map<string, NormalizedEntity>();
  const nameToId: Record<string, string> = {};   // name + aliases -> id (first owner wins)

  const register = (key: string, id: string): void => {
    if (key && nameToId[key] === undefined) nameToId[key] = id;
  };

  for (const e of raw) {
    const canon = canonicalizeName(e.name);
    const aliasCanons = (e.aliases ?? []).map(canonicalizeName).filter((a) => a.length > 0);

    // 1. Merge only when this name, or an alias, matches an EXISTING entity's NAME.
    let id = canon ? idByName.get(canon) : undefined;
    if (!id) {
      for (const a of aliasCanons) {
        const found = idByName.get(a);
        if (found) { id = found; break; }
      }
    }

    // 2. Otherwise allocate a new id (disambiguating the rare hash collision).
    if (!id) {
      const base = makeEntityId(prefix, e.name);
      id = base;
      let n = 2;
      while (canonById.has(id) && canonById.get(id) !== canon) {
        id = `${base}_${n++}`;
      }
      canonById.set(id, canon);
    }

    // 3. Only the canonical NAME is a merge key; aliases are ambiguous so are not.
    if (canon) idByName.set(canon, id);
    register(canon, id);
    for (const a of aliasCanons) register(a, id);

    // 4. Insert or merge — earlier attributes win, later fills gaps.
    const prev = entityById.get(id);
    if (prev) {
      entityById.set(id, {
        ...e,
        ...prev,
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
    nameToId,
    catalog: entities.map((e) => ({ id: e.id, name: e.name })),
  };
}
