import { useState } from "react";
import { Sparkles, Loader2, Send } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { AnswerMarkdown } from "@/components/answer-markdown";
import type { AskScope } from "@/lib/types";

const SUGGESTIONS: Record<AskScope, string[]> = {
  account: [
    "Which upcoming deals are missing an expense cap I should add?",
    "Are any expense categories trending up over the last 3 months?",
    "What's our overall dispute rate, and is it higher in any one cell?",
  ],
  show: [
    "Is this show running over our usual expense pattern?",
    "Should I add a hospitality cap before settling?",
    "Is the agent's guarantee in line with what we'd pay this artist?",
  ],
  artist: [
    "Has this artist been profitable historically?",
    "Where has friction tended to land on their nights?",
    "What expense cap should I write into their next deal?",
  ],
};

const SCOPE_LABEL: Record<AskScope, string> = {
  account: "the venue's overall expense pattern",
  show: "this show",
  artist: "this artist",
};

export function AiPrompt({
  scope,
  id,
  variant = "inline",
  title,
  subtitle,
  placeholder,
  suggestions,
}: {
  scope: AskScope;
  id?: string;
  variant?: "inline" | "prominent";
  title?: string;
  subtitle?: string;
  placeholder?: string;
  // Override the default suggestion chips for this scope. Useful when the
  // same scope (e.g. `account`) is reused on a tab with a more specific
  // analytical focus, like Deal Analysis.
  suggestions?: string[];
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setAnswer(null);
    setContextSummary(null);
    setConfidence(null);
    setDisclaimer(null);
    setWarning(null);
    setError(null);
    try {
      const out = await api.aiAsk({ scope, id, question: trimmed });
      setAnswer(out.answer);
      setContextSummary(out.contextSummary || null);
      setConfidence(out.confidence || null);
      setDisclaimer(out.disclaimer ?? null);
      setWarning(out.warning ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setLoading(false);
    }
  }

  const isProminent = variant === "prominent";

  const formInner = (
    <>
      <div className={`flex items-center gap-2 mb-2 ${isProminent ? "" : ""}`}>
        <Sparkles className={`${isProminent ? "h-4 w-4" : "h-3.5 w-3.5"} text-violet-600`} />
        <div className={isProminent ? "" : ""}>
          <div className={`${isProminent ? "text-[14px]" : "text-[12px]"} font-semibold text-ink-900`}>
            {title ?? "Ask about " + SCOPE_LABEL[scope]}
          </div>
          {isProminent && (
            <div className="text-[11px] text-ink-500">
              {subtitle ??
                "Single-turn, grounded in venue-calibrated baselines and live deal data."}
            </div>
          )}
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder ?? `Ask about ${SCOPE_LABEL[scope]}…`}
          className={`flex-1 px-3 py-2 text-[12.5px] bg-white rounded-md ring-1 ring-ink-200 focus:ring-violet-300 focus:outline-none ${
            isProminent ? "" : ""
          }`}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Ask
        </button>
      </form>

      {!answer && !error && !warning && !loading && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(suggestions ?? SUGGESTIONS[scope]).slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                submit(s);
              }}
              className="text-[10.5px] text-ink-600 px-2 py-1 rounded-full bg-violet-50/60 ring-1 ring-violet-200/60 hover:bg-violet-50 hover:text-ink-900 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {warning && (
        <div className="mt-3 rounded-md p-2.5 bg-amber-50 ring-1 ring-amber-200/70 text-[11.5px] text-amber-800">
          {warning}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md p-2.5 bg-rose-50 ring-1 ring-rose-200/70 text-[11.5px] text-rose-700">
          {error}
        </div>
      )}
      {answer && (
        <div className="mt-3 rounded-md p-3 bg-white ring-1 ring-violet-200/60">
          <AnswerMarkdown text={answer} />
          {(contextSummary || confidence) && (
            <div className="mt-2.5 pt-2 border-t border-ink-100/70 flex items-center gap-2 flex-wrap text-[10.5px] text-ink-500">
              {confidence && (
                <span
                  className={`px-1.5 py-0.5 rounded-full font-medium uppercase tracking-[0.06em] ${
                    confidence === "high"
                      ? "bg-emerald-50 text-emerald-700"
                      : confidence === "med"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {confidence} confidence
                </span>
              )}
              {contextSummary && <span>· {contextSummary}</span>}
            </div>
          )}
          {disclaimer && (
            <div className="mt-2 pt-2 border-t border-ink-100/70 text-[10.5px] leading-snug text-ink-500 italic">
              {disclaimer}
            </div>
          )}
        </div>
      )}
    </>
  );

  if (isProminent) {
    return (
      <Card className="mb-8 ring-violet-200/60">
        <CardContent>{formInner}</CardContent>
      </Card>
    );
  }
  return (
    <div className="rounded-lg bg-violet-50/30 ring-1 ring-violet-200/40 p-3">
      {formInner}
    </div>
  );
}
