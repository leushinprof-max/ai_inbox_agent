import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function localConfig() {
  const config = readFileSync(
    new URL("../supabase/config.toml", import.meta.url),
    "utf8",
  );
  if (
    !config.includes('project_id = "ai-inbox-standalone-dev"') ||
    !config.includes("port = 56621")
  )
    throw new Error(
      "Unexpected local project. Refusing to use another database.",
    );
  const status = JSON.parse(
    execFileSync("supabase", ["status", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  if (
    status.API_URL !== "http://127.0.0.1:56621" ||
    !status.DB_URL?.includes("127.0.0.1:56622/")
  )
    throw new Error("Expected the isolated loopback Supabase instance.");
  return status;
}
