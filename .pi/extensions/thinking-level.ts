import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof LEVELS)[number];

function parseLevel(args: string): ThinkingLevel | undefined {
  const value = args.trim().toLowerCase();
  if (value === "extra-high" || value === "extra" || value === "xtra" || value === "xtra-high") {
    return "xhigh";
  }
  return LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;
}

export default function (pi: ExtensionAPI) {
  const setThinking = (name: string) => ({
    description: `Set thinking level. Usage: /${name} off|minimal|low|medium|high|xhigh`,
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const normalized = prefix.trim().toLowerCase();
      const items = LEVELS
        .filter((level) => level.startsWith(normalized))
        .map((level) => ({ value: level, label: level }));
      return items.length > 0 ? items : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const requested = parseLevel(args);
      if (!requested) {
        ctx.ui.notify(
          `Current thinking: ${pi.getThinkingLevel()}. Usage: /${name} off|minimal|low|medium|high|xhigh`,
          "info",
        );
        return;
      }

      const previous = pi.getThinkingLevel();
      pi.setThinkingLevel(requested);
      const actual = pi.getThinkingLevel();
      ctx.ui.setStatus("thinking", `thinking: ${actual}`);

      if (actual !== requested) {
        ctx.ui.notify(`Thinking clamped by current model: requested ${requested}, using ${actual}`, "warning");
      } else {
        ctx.ui.notify(`Thinking: ${previous} → ${actual}`, "info");
      }
    },
  });

  pi.registerCommand("thinking", setThinking("thinking"));
  pi.registerCommand("think", setThinking("think"));

  pi.on("thinking_level_select", async (event, ctx) => {
    ctx.ui.setStatus("thinking", `thinking: ${event.level}`);
  });
}
