import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readAgentKnowledge,
  writeAgentKnowledge,
  hasAgentKnowledge,
} from "../src/domain/agent-knowledge";

test("legacy content survives opening and saving structured Knowledge", () => {
  const legacy = "Product description\n\nPricing: $20.\n{not json}";
  assert.equal(readAgentKnowledge(legacy).productOffer, legacy);
  assert.equal(
    readAgentKnowledge(writeAgentKnowledge(readAgentKnowledge(legacy)))
      .productOffer,
    legacy,
  );
});
test("company, offer and FAQ survive a lossless round trip", () => {
  const value = {
    companyName: "Aster",
    productOffer: "Line 1\n}\nLine 2",
    faq: [{ question: "Pricing?", answer: 'Quote: "$20"\nNext line' }],
  };
  assert.deepEqual(readAgentKnowledge(writeAgentKnowledge(value)), value);
});
test("answers appended by the review workflow preserve structured fields", () => {
  const value = {
    companyName: "Aster",
    productOffer: "Product",
    faq: [{ question: "Who?", answer: "Teams" }],
  };
  assert.deepEqual(
    readAgentKnowledge(writeAgentKnowledge(value) + "\n\nNew approved answer"),
    { ...value, productOffer: "Product\n\nNew approved answer" },
  );
});
test("malformed structured content is retained as legacy text", () => {
  const value =
    '{"format":"agent-knowledge-v1","companyName":"Aster","productOffer":"Offer","faq":[null]}';
  assert.equal(readAgentKnowledge(value).productOffer, value);
});
test("company or empty FAQ alone cannot qualify as product knowledge", () => {
  assert.equal(
    hasAgentKnowledge(
      writeAgentKnowledge({
        companyName: "Aster",
        productOffer: " ",
        faq: [{ question: "", answer: "" }],
      }),
    ),
    false,
  );
  assert.equal(hasAgentKnowledge("Legacy approved information"), true);
});
