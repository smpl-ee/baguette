import { useState } from 'react';
import MarkdownContent from './MarkdownContent.jsx';

function QuestionBlock({ question, answer, onChange }) {
  const { question: text, options, multiSelect } = question;
  const hasMarkdown = options.some((o) => o.markdown);

  const isSelected = (label) => {
    if (multiSelect) return answer.selected.has(label);
    return answer.selected === label;
  };

  const toggle = (label) => {
    if (multiSelect) {
      const next = new Set(answer.selected);
      next.has(label) ? next.delete(label) : next.add(label);
      onChange({ ...answer, selected: next });
    } else {
      onChange({ ...answer, selected: label });
    }
  };

  const [hovered, setHovered] = useState(null);
  const previewOption =
    hovered ??
    (multiSelect
      ? options.find((o) => answer.selected.has(o.label))
      : options.find((o) => o.label === answer.selected));

  const allOptions = [
    ...options,
    { label: 'Other', description: 'Enter a custom answer', markdown: null },
  ];

  return (
    <div className="mb-6 last:mb-0">
      <div className="text-sm font-medium text-white mb-3 prose prose-sm prose-invert max-w-none">
        <MarkdownContent>{text}</MarkdownContent>
      </div>
      <div className={hasMarkdown ? 'flex gap-3' : 'space-y-2'}>
        <div className={`space-y-2 ${hasMarkdown ? 'w-1/2 shrink-0' : ''}`}>
          {allOptions.map((opt) => {
            const selected = isSelected(opt.label);
            return (
              <button
                key={opt.label}
                onClick={() => toggle(opt.label)}
                onMouseEnter={() => setHovered(opt)}
                onMouseLeave={() => setHovered(null)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  selected
                    ? 'bg-amber-500/20 border-amber-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 w-4 h-4 rounded-${multiSelect ? 'sm' : 'full'} border flex items-center justify-center ${
                      selected ? 'bg-amber-500 border-amber-500' : 'border-zinc-500'
                    }`}
                  >
                    {selected && (
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="currentColor"
                        viewBox="0 0 12 12"
                      >
                        <path
                          d="M10 3L5 8.5 2 5.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    {opt.description && (
                      <div className="text-xs text-zinc-500 mt-0.5">{opt.description}</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {hasMarkdown && previewOption?.markdown && (
          <div className="flex-1 bg-zinc-800 rounded-lg border border-zinc-700 p-3 overflow-auto max-h-48">
            <MarkdownContent>{previewOption.markdown}</MarkdownContent>
          </div>
        )}
      </div>

      {(multiSelect ? answer.selected.has('Other') : answer.selected === 'Other') && (
        <input
          autoFocus
          type="text"
          value={answer.otherText}
          onChange={(e) => onChange({ ...answer, otherText: e.target.value })}
          placeholder="Your answer…"
          className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
      )}
    </div>
  );
}

function buildAnswersMap(questions, answers) {
  const map = {};
  questions.forEach((q, i) => {
    const ans = answers[i];
    if (q.multiSelect) {
      const parts = [];
      for (const label of ans.selected) {
        if (label === 'Other') {
          if (ans.otherText.trim()) parts.push(ans.otherText.trim());
        } else {
          parts.push(label);
        }
      }
      map[q.question] = parts.join(', ');
    } else {
      if (ans.selected === 'Other') {
        map[q.question] = ans.otherText.trim() || 'Other';
      } else {
        map[q.question] = ans.selected ?? '';
      }
    }
  });
  return map;
}

function isComplete(questions, answers) {
  return questions.every((q, i) => {
    const ans = answers[i];
    if (q.multiSelect) {
      if (ans.selected.size === 0) return false;
      if (ans.selected.has('Other') && !ans.otherText.trim()) return false;
    } else {
      if (!ans.selected) return false;
      if (ans.selected === 'Other' && !ans.otherText.trim()) return false;
    }
    return true;
  });
}

function AskUserQuestionForm({ request, onRespond, onClose }) {
  const { requestId, input } = request;
  const questions = input?.questions ?? [];

  const [answers, setAnswers] = useState(() =>
    questions.map((q) => ({
      selected: q.multiSelect ? new Set() : null,
      otherText: '',
    }))
  );

  const handleSubmit = (answersToSubmit = answers) => {
    const answersMap = buildAnswersMap(questions, answersToSubmit);
    onRespond(requestId, true, null, answersMap);
  };

  const canSubmit = isComplete(questions, answers);

  const updateAnswer = (i, value) => {
    const newAnswers = answers.map((a, idx) => (idx === i ? value : a));
    setAnswers(newAnswers);
    // Auto-submit if complete, all single-select, and no "Other" chosen
    const noOther = newAnswers.every((a) => a.selected !== 'Other');
    const allSingle = questions.every((q) => !q.multiSelect);
    if (allSingle && noOther && isComplete(questions, newAnswers)) {
      handleSubmit(newAnswers);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4 overflow-auto max-h-[50vh]">
        {questions.map((q, i) => (
          <QuestionBlock
            key={i}
            question={q}
            answer={answers[i]}
            onChange={(val) => updateAnswer(i, val)}
          />
        ))}
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => handleSubmit()}
          disabled={!canSubmit}
          className="flex-1 sm:flex-none px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 rounded-lg text-sm font-medium transition-colors"
        >
          Submit
        </button>
        <button
          onClick={() => onRespond(requestId, false, 'User dismissed the question.')}
          className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Dismiss
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-sm font-medium transition-colors"
          >
            Later
          </button>
        )}
      </div>
    </div>
  );
}

AskUserQuestionForm.title = 'Claude has a question';
AskUserQuestionForm.subtitle = () => 'Answer to continue the session.';

export default AskUserQuestionForm;
