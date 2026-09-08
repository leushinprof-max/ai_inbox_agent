import assert from "node:assert/strict";
import test from "node:test";
import { sectionRoute, sectionTitles } from "../src/lib/section-route";

test("loading and loaded routes share a frame decision for every section", () => {
  for (const section of Object.keys(sectionTitles)) {
    const framed = ["drafts", "conversations", "agents", "settings"].includes(
      section,
    );
    for (const path of [
      `/w/workspace-id/${section}`,
      `/demo/${section}`,
      `/demo/states/${section}/loading`,
    ]) {
      assert.deepEqual(sectionRoute(path), { section, detail: false, framed });
    }
  }
});

test("detail/new pages get their own loading layout", () => {
  for (const section of ["conversations", "agents"]) {
    for (const path of [
      `/w/ws/${section}/record`,
      `/demo/${section}/new`,
      `/demo/states/${section}/loading-detail`,
    ]) {
      assert.deepEqual(sectionRoute(path), {
        section,
        detail: true,
        framed: true,
      });
    }
  }
});

test("workspace and record names cannot masquerade as the active section", () => {
  assert.equal(sectionRoute("/w/drafts/settings").section, "settings");
  assert.equal(sectionRoute("/w/agents/product-admin").framed, false);
  assert.equal(sectionRoute("/w/ws/agents/conversations").section, "agents");
  for (const path of [
    "/workspaces",
    "/login",
    "/demo/states",
    "/w/ws/unknown",
  ]) {
    assert.equal(sectionRoute(path).framed, false);
    assert.equal(sectionRoute(path).section, null);
  }
});
