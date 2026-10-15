import { describe, expect, it } from "vitest";
import { classifyInventory, classifyInventoryItem } from "../src/classify.js";

describe("inventory classifier", () => {
  it("preserves friendly-123 stock severity", () => {
    expect(classifyInventoryItem({name:"A",stock:0}).color).toBe("red");
    expect(classifyInventoryItem({name:"A",stock:2}).color).toBe("orange");
    expect(classifyInventoryItem({name:"A",stock:10,daysSinceLastSale:61}).color).toBe("black");
    expect(classifyInventoryItem({name:"A",stock:9,price:20,cost:8}).color).toBe("yellow");
    expect(classifyInventoryItem({name:"A",stock:12,price:20,cost:15}).color).toBe("green");
  });
  it("lets expiry raise severity", () => {
    expect(classifyInventoryItem({name:"Fresh",stock:10,expiresInDays:6}).color).toBe("orange");
    expect(classifyInventoryItem({name:"Fresh",stock:10,expiresInDays:2}).color).toBe("red");
    expect(classifyInventoryItem({name:"Fresh",stock:10,daysSinceLastSale:90,expiresInDays:6}).color).toBe("orange");
  });
  it("supports EN ES PT labels", () => {
    expect(classifyInventoryItem({name:"A",stock:12},"en").label).toBe("Healthy");
    expect(classifyInventoryItem({name:"A",stock:12},"es").label).toBe("Sano");
    expect(classifyInventoryItem({name:"A",stock:12},"pt").label).toBe("Saudável");
  });
  it("sorts highest attention first", () => {
    const r=classifyInventory([{name:"Green",stock:12},{name:"Red",stock:0},{name:"Black",stock:10,daysSinceLastSale:90}],"en");
    expect(r.items.map(x=>x.name)).toEqual(["Red","Black","Green"]);
  });
  it("caps tool processing at 500 items", () => {
    const items=Array.from({length:600},(_,i)=>({name:`I${i}`,stock:10}));
    expect(classifyInventory(items,"en").items).toHaveLength(500);
  });
});
