import { InboxError, requireText, type Scope } from "./inbox";

export type SendOutcome =
  | { status: "sent" }
  | { status: "rejected"; reason: string }
  | { status: "unknown" };
export interface SendRequest {
  operationId: string;
  conversationId: string;
  body: string;
  draft?: { id: string; revision: number; sourceRevision: number };
}
export interface ReservedSend {
  operationId: string;
  providerConversationId: string;
  senderId: number;
  body: string;
}
export interface SendRepository {
  /** Atomically verifies membership, conversation ownership, draft revisions and operation identity. */
  reserve(
    scope: Scope,
    request: SendRequest,
  ): Promise<
    | { kind: "reserved"; send: ReservedSend }
    | { kind: "existing"; outcome: SendOutcome | { status: "sending" } }
  >;
  /** A successful acknowledgement completes the draft and stores an outbound acknowledgement atomically. */
  complete(
    scope: Scope,
    operationId: string,
    outcome: SendOutcome,
  ): Promise<void>;
}
export interface SendTransport {
  send(message: ReservedSend): Promise<SendOutcome>;
}

export async function sendReply(
  repository: SendRepository,
  transport: SendTransport,
  scope: Scope,
  request: SendRequest,
) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(request.operationId))
    throw new InboxError("invalid", "Invalid send request.");
  const body = requireText(request.body, "Message");
  const reservation = await repository.reserve(scope, { ...request, body });
  if (reservation.kind === "existing") return reservation.outcome;
  let outcome: SendOutcome;
  try {
    outcome = await transport.send(reservation.send);
  } catch {
    outcome = { status: "unknown" };
  }
  await repository.complete(scope, request.operationId, outcome);
  return outcome;
}
