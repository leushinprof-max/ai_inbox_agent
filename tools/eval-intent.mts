import { mkdirSync, writeFileSync } from "node:fs";
import {
  createInboxModel,
  type ModelInput,
} from "../src/integrations/ai/classify";
import { demoLabels } from "../src/domain/labels";
const key = process.env.OPENAI_API_KEY;
if (!key)
  throw new Error(
    "Set OPENAI_API_KEY to run this opt-in synthetic evaluation.",
  );
const model = createInboxModel(key);
const labels = demoLabels("eval");
const agent = {
  name: "ReStaff",
  goal: "Answer questions and arrange a demo",
  language: "Match the conversation",
  knowledge:
    "ReStaff helps companies pay contractors. A demo can be requested at https://example.test/demo. Do not invent pricing.",
  replyGroups: ["positive", "neutral", "negative"] as const,
};
const cases = [
  [
    "team_invitation_accepted",
    [
      ["outbound", "Давайте созвонимся?"],
      ["inbound", "Да, круто, давайте созвонимся."],
    ],
    "interested",
    null,
  ],
  [
    "team_invitation_scheduled",
    [
      ["outbound", "Would you like a call?"],
      ["inbound", "Yes, Tuesday at 3 works."],
    ],
    "interested",
    null,
  ],
  [
    "team_invitation_ack",
    [
      ["outbound", "Давайте созвонимся?"],
      ["inbound", "Да, давайте"],
      ["outbound", "Приглашение на вторник отправлено."],
      ["inbound", "👍"],
    ],
    "interested",
    false,
  ],
  [
    "lead_initiates_meeting",
    [
      ["outbound", "Мы помогаем с выплатами подрядчикам."],
      ["inbound", "Давайте созвонимся и обсудим. Когда вам удобно?"],
    ],
    "meeting_request",
    null,
  ],
  [
    "unanswered_team_invitation",
    [
      [
        "inbound",
        "Есть ли реферальная программа? Расскажите про комиссии и документы.",
      ],
      ["outbound", "Да. Предлагаю созвониться."],
      ["outbound", "Удобно на следующей неделе?"],
    ],
    "information_request",
    false,
  ],
  [
    "meeting_ack",
    [
      ["inbound", "Давайте созвонимся во вторник в 15:00."],
      ["outbound", "Договорились. Приглашение отправлено."],
      ["inbound", "👍"],
    ],
    "meeting_request",
    false,
  ],
  [
    "link_ack",
    [
      ["outbound", "Прислать ссылку на демо?"],
      ["inbound", "👍"],
    ],
    "information_request",
    true,
  ],
  [
    "changed_mind",
    [
      ["inbound", "Не интересно."],
      ["outbound", "У нас есть выплаты подрядчикам за рубеж."],
      ["inbound", "Тогда интересно, пришлите подробности."],
    ],
    "information_request",
    true,
  ],
  [
    "competitor_interest",
    [
      [
        "inbound",
        "Мы пользуемся конкурентом, но расскажите, что вы предлагаете.",
      ],
    ],
    "information_request",
    true,
  ],
  [
    "competitor_refusal",
    [["inbound", "Мы уже пользуемся другим сервисом, спасибо, не интересно."]],
    "not_interested",
    false,
  ],
  ["later", [["inbound", "Вернитесь в следующем квартале."]], "not_now", null],
  ["unknown", [["inbound", "Алексей?"]], null, false],
  ["stop", [["inbound", "Не пишите мне больше."]], "not_interested", false],
  [
    "referral",
    [["inbound", "По этому вопросу напишите Анне из финансового отдела."]],
    "referral",
    null,
  ],
  [
    "wrong_person",
    [["inbound", "Я этим не занимаюсь, вы обратились не по адресу."]],
    "wrong_person",
    null,
  ],
] as const;
const results = [];
const repeats = Number(process.env.INBOX_EVAL_REPEATS ?? 1);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
  throw new Error("INBOX_EVAL_REPEATS must be 1 to 5");
for (let repeat = 1; repeat <= repeats; repeat++) {
  for (const [name, transcript, label, reply] of cases) {
    const input: ModelInput = {
      labels,
      agent: { ...agent, replyGroups: [...agent.replyGroups] },
      messages: transcript.map(([direction, body], i) => ({
        id: `m${i}`,
        direction,
        body,
      })),
      generateDraft: true,
    };
    try {
      const output = await model.classify(input);
      const pass =
        output.labelId === label &&
        (reply === null || output.shouldReply === reply);
      results.push({ name, repeat, pass, expected: { label, reply }, output });
      console.log(
        JSON.stringify({
          name,
          repeat,
          pass,
          label: output.labelId,
          reply: output.shouldReply,
        }),
      );
    } catch (e) {
      results.push({
        name,
        pass: false,
        error: e instanceof Error ? e.message : "error",
      });
      console.log(
        JSON.stringify({
          name,
          pass: false,
          error: e instanceof Error ? e.message : "error",
        }),
      );
    }
  }
}
mkdirSync(".artifacts", { recursive: true });
writeFileSync(".artifacts/intent-eval.json", JSON.stringify(results, null, 2));

if (results.some((r) => !r.pass)) process.exitCode = 1;
