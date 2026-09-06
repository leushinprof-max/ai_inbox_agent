import Link from "next/link";
import { Empty } from "@/components/ui";
export default function NotFound() {
  return (
    <main className="login-page">
      <Empty
        title="Page not found"
        action={
          <Link className="btn" href="/workspaces">
            Back to workspaces
          </Link>
        }
      >
        The page may have moved or you may not have access.
      </Empty>
    </main>
  );
}
