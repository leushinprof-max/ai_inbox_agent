import "server-only";
import { cache } from "react";
import { connection } from "next/server";

// One timestamp per request, serialized into every demo provider it renders.
export const getDemoNow = cache(async () => {
  await connection();
  return Date.now();
});
