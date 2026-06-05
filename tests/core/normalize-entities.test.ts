import { describe, it, expect } from "vitest";
import { normalizeEntities } from "../../src/core/entities/normalize-entities";

describe("normalizeEntities", () => {
  it("assigns deterministic ids and builds a parallel catalog", () => {
    const r = normalizeEntities("char", [{ name: "林深" }, { name: "苏晚" }]);
    expect(r.entities).toHaveLength(2);
    expect(r.catalog).toEqual(r.entities.map((e) => ({ id: e.id, name: e.name })));
    expect(r.entities[0]!.id).toMatch(/^char_[0-9a-f]{6}$/);
  });

  it("merges duplicates that share a name, keeping prior attributes", () => {
    const r = normalizeEntities("char", [
      { name: "林深", motivation: "复仇" },
      { name: "林深", aliases: ["老林"] },
    ]);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.aliases).toContain("老林");
    expect(r.entities[0]!.motivation).toBe("复仇");
  });

  it("merges when a later entity's alias matches an earlier name", () => {
    const r = normalizeEntities("char", [{ name: "林深" }, { name: "林队长", aliases: ["林深"] }]);
    expect(r.entities).toHaveLength(1);
  });

  it("maps both names and aliases to the assigned id", () => {
    const r = normalizeEntities("char", [{ name: "林深", aliases: ["老林"] }]);
    const id = r.entities[0]!.id;
    expect(r.nameToId["林深"]).toBe(id);
    expect(r.nameToId["老林"]).toBe(id);
  });

  it("does NOT merge distinct entities that merely share a non-name alias", () => {
    const r = normalizeEntities("char", [
      { name: "张三", aliases: ["老大"] },
      { name: "李四", aliases: ["老大"] },
    ]);
    expect(r.entities).toHaveLength(2);
  });

  it("keeps nameToId consistent for a shared alias (first owner wins, no overwrite)", () => {
    const r = normalizeEntities("char", [
      { name: "A", aliases: ["x"] },
      { name: "B", aliases: ["y"] },
      { name: "C", aliases: ["x", "y"] },
    ]);
    expect(r.entities).toHaveLength(3);
    expect(r.nameToId["x"]).toBe(r.entities.find((e) => e.name === "A")!.id);
    expect(r.nameToId["y"]).toBe(r.entities.find((e) => e.name === "B")!.id);
  });

  it("keeps earlier attribute values on conflict (earlier wins, later fills gaps)", () => {
    const r = normalizeEntities("char", [
      { name: "林深", motivation: "复仇", background: "渔民出身" },
      { name: "林深", motivation: "守护", weapon: "鱼叉" },
    ]);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.motivation).toBe("复仇");
    expect(r.entities[0]!.background).toBe("渔民出身");
    expect(r.entities[0]!.weapon).toBe("鱼叉");
  });
});
