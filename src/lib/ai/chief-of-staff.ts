import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { ALL_TOOLS, buildSystemPrompt, runTool, type ToolProposal } from "./tools";

export type Citation = { label: string; source: string; detail?: string };

export type AssistantReply = {
  text: string;
  citations: Citation[];
  proposals: ToolProposal[];
  toolCalls: { name: string; input: unknown }[];
  /** True when no API key is configured and the deterministic path answered. */
  offline: boolean;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
const MAX_TOOL_ROUNDS = 6;

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Runs the Chief of Staff over the user's own data.
 *
 * A manual tool loop rather than the SDK tool runner, because each result also
 * has to yield a citation and, for write tools, a proposal the UI can render as
 * a confirmation card. All tool results for a round go back in one user
 * message, which is what keeps parallel tool use working.
 */
export async function askChiefOfStaff({
  userId,
  userName,
  weekStartsOn,
  history,
  question,
}: {
  userId: string;
  userName: string;
  weekStartsOn: number;
  history: ChatTurn[];
  question: string;
}): Promise<AssistantReply> {
  if (!aiConfigured()) {
    return answerWithoutModel(userId, weekStartsOn, question);
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: question },
  ];

  const citations: Citation[] = [];
  const proposals: ToolProposal[] = [];
  const toolCalls: { name: string; input: unknown }[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: buildSystemPrompt(userName, weekStartsOn),
        tools: ALL_TOOLS,
        messages,
      })
      .finalMessage();

    if (response.stop_reason === "refusal") {
      return {
        text: "I can't help with that one. Ask me something about your tasks, projects, goals, calendar, health, money or time and I will look it up.",
        citations,
        proposals,
        toolCalls,
        offline: false,
      };
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return {
        text: text || "I could not put an answer together for that. Try asking it a different way.",
        citations,
        proposals,
        toolCalls,
        offline: false,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    // Every tool result for this round goes back in a single user message.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      toolCalls.push({ name: toolUse.name, input: toolUse.input });
      try {
        const result = await runTool(
          userId,
          weekStartsOn,
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
        );
        if (result.citation) citations.push(result.citation);
        if (result.proposal) proposals.push(result.proposal);
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: result.content });
      } catch (error) {
        // Return the failure rather than dropping the block, so the model can
        // say what it could not read instead of silently guessing.
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `That lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  return {
    text: "That took more lookups than I allow in one go. Try narrowing the question.",
    citations,
    proposals,
    toolCalls,
    offline: false,
  };
}

/**
 * Deterministic answers when no API key is set.
 *
 * The point is that the Chief of Staff still tells the truth about the data
 * without a model: it runs the same tools and reports what they returned,
 * clearly labelled as a summary rather than analysis.
 */
async function answerWithoutModel(
  userId: string,
  weekStartsOn: number,
  question: string,
): Promise<AssistantReply> {
  const q = question.toLowerCase();

  const pick = (): string[] => {
    if (/(slip|behind|risk|neglect|attention|stall|wrong)/.test(q)) return ["get_attention_signals"];
    if (/(sleep|health|hrv|heart|workout|train|fitness)/.test(q)) return ["get_health"];
    if (/(spend|money|budget|saving|net worth|financ)/.test(q)) return ["get_finances"];
    if (/(time|hours|meeting|calendar|schedule|week)/.test(q)) return ["get_time_analytics", "get_calendar"];
    if (/(goal)/.test(q)) return ["list_goals"];
    if (/(project)/.test(q)) return ["list_projects"];
    if (/(who|people|friend|call|relationship)/.test(q)) return ["get_relationships"];
    if (/(habit|streak)/.test(q)) return ["get_habits"];
    return ["get_today", "get_attention_signals"];
  };

  const citations: Citation[] = [];
  const sections: string[] = [];

  for (const tool of pick()) {
    const result = await runTool(userId, weekStartsOn, tool, {});
    if (result.citation) citations.push(result.citation);
    sections.push(result.content);
  }

  return {
    text: [
      "No AI model is connected, so this is a direct readout of your data rather than analysis. Add `ANTHROPIC_API_KEY` to your `.env` to enable the full Chief of Staff.",
      "",
      ...sections,
    ].join("\n"),
    citations,
    proposals: [],
    toolCalls: [],
    offline: true,
  };
}
