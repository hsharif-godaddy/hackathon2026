/**
 * Renderers for common agent tool calls.
 *
 * Each registered renderer can return either:
 *   - a `ReactNode` — treated as a one-line summary shown next to the tool
 *     name in the row header, or
 *   - `{ summary?: ReactNode; body?: ReactNode }` — when the tool benefits
 *     from a richer always-visible card (e.g. `askQuestion`).
 *
 * Renderers MUST be defensive: if the input shape does not match what they
 * expect, return null and let the caller fall back to the generic JSON
 * preview. The `renderToolCall` dispatcher additionally wraps each renderer
 * in try/catch so unexpected throws never break the UI.
 */

import type { CSSProperties, ReactNode } from 'react';

import type { ToolCall } from '@/lib/agent-message-types';

export interface ToolRenderResult {
    summary: ReactNode | null;
    body: ReactNode | null;
}

type ToolRendererReturn = ReactNode | { summary?: ReactNode; body?: ReactNode } | null;
type ToolRenderer = (toolCall: ToolCall) => ToolRendererReturn;

function asObj(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

interface ParsedQuestion {
    question: string;
    suggestions: string[];
    allowOther: boolean;
    multiSelect: boolean;
}

function parseQuestions(input: Record<string, unknown> | null): ParsedQuestion[] | null {
    const raw = input ? asArray(input.questions) : null;
    if (!raw || raw.length === 0) return null;
    const parsed: ParsedQuestion[] = [];
    for (const entry of raw) {
        const obj = asObj(entry);
        if (!obj) continue;
        const question = asString(obj.question);
        if (!question) continue;
        const suggestionsRaw = asArray(obj.suggestions) ?? [];
        const suggestions = suggestionsRaw
            .map((s) => {
                const sObj = asObj(s);
                return sObj ? asString(sObj.text) : null;
            })
            .filter((value): value is string => Boolean(value));
        parsed.push({
            question,
            suggestions,
            allowOther: obj.allowOther === true,
            multiSelect: obj.multiSelect === true,
        });
    }
    return parsed.length ? parsed : null;
}

const askQuestion: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const questions = parseQuestions(input);
    if (!questions) return null;
    return {
        summary: `${questions.length} question${questions.length === 1 ? '' : 's'}`,
        body: <QuestionsCard questions={questions} />,
    };
};

const suggestedResponseRich: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const question = input ? asString(input.question) : null;
    if (!question) return null;
    const suggestionsRaw = input ? asArray(input.suggestions) : null;
    const suggestions = (suggestionsRaw ?? [])
        .map((s) => {
            const sObj = asObj(s);
            return sObj ? asString(sObj.text) : null;
        })
        .filter((value): value is string => Boolean(value));
    return {
        summary: `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}`,
        body: (
            <QuestionsCard
                questions={[{
                    question,
                    suggestions,
                    allowOther: input?.allowOther === true,
                    multiSelect: input?.multiSelect === true,
                }]}
            />
        ),
    };
};

function QuestionsCard({ questions }: { questions: ParsedQuestion[] }) {
    return (
        <div style={questionsCardStyle}>
            {questions.map(function renderQuestion(q, index) {
                return (
                    <div
                        key={`${index}-${q.question}`}
                        style={index > 0 ? questionRowStyle : { ...questionRowStyle, borderTop: 'none', paddingTop: 0 }}
                    >
                        <div style={questionTextStyle}>
                            {questions.length > 1 && (
                                <span style={questionIndexStyle}>Q{index + 1}.</span>
                            )}
                            <span>{q.question}</span>
                        </div>
                        {q.suggestions.length > 0 && (
                            <div style={chipRowStyle}>
                                {q.suggestions.map(function renderChip(text, chipIndex) {
                                    return (
                                        <span key={`${chipIndex}-${text}`} style={chipStyle}>
                                            {text}
                                        </span>
                                    );
                                })}
                                {q.allowOther && (
                                    <span style={{ ...chipStyle, ...otherChipStyle }}>+ custom answer</span>
                                )}
                            </div>
                        )}
                        <div style={questionMetaStyle}>
                            {q.multiSelect ? 'multi-select' : 'single-select'}
                            {' · '}
                            {q.suggestions.length} option{q.suggestions.length === 1 ? '' : 's'}
                            {q.allowOther && ' · custom allowed'}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

const questionsCardStyle: CSSProperties = {
    margin: '0.5rem 0.75rem',
    padding: '0.75rem 0.875rem',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    display: 'flex',
    flexDirection: 'column',
};

const questionRowStyle: CSSProperties = {
    paddingTop: '0.625rem',
    borderTop: '1px dashed #e2e8f0',
};

const questionTextStyle: CSSProperties = {
    display: 'flex',
    gap: '0.4rem',
    fontSize: '0.85rem',
    color: '#0f172a',
    fontWeight: 500,
    lineHeight: 1.4,
};

const questionIndexStyle: CSSProperties = {
    color: '#94a3b8',
    fontWeight: 600,
};

const chipRowStyle: CSSProperties = {
    marginTop: '0.5rem',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.375rem',
};

const chipStyle: CSSProperties = {
    backgroundColor: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '999px',
    padding: '0.2rem 0.625rem',
    fontSize: '0.75rem',
    color: '#1e293b',
};

const otherChipStyle: CSSProperties = {
    borderStyle: 'dashed',
    color: '#64748b',
    backgroundColor: 'transparent',
};

const questionMetaStyle: CSSProperties = {
    marginTop: '0.4rem',
    fontSize: '0.7rem',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const handoff: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const target = input ? asString(input.targetAgent) : null;
    return target ? `→ ${target}` : null;
};

const setProjectName: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const name = input ? asString(input.name) : null;
    return name ? `→ “${name}”` : null;
};

interface ParsedTodoItem {
    title: string;
    description: string | null;
    status: string | null;
    priority: string | null;
    id: string | null;
}

function parseTodoItems(value: unknown): ParsedTodoItem[] | null {
    const raw = asArray(value);
    if (!raw || raw.length === 0) return null;
    const parsed: ParsedTodoItem[] = [];
    for (const entry of raw) {
        const obj = asObj(entry);
        if (!obj) continue;
        const title = asString(obj.title);
        if (!title) continue;
        parsed.push({
            title,
            description: asString(obj.description),
            status: asString(obj.status),
            priority: asString(obj.priority),
            id: asString(obj.id),
        });
    }
    return parsed.length ? parsed : null;
}

const todoList: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const operation = asString(input.operation);
    if (!operation) return null;

    const listName = asString(input.listName);
    const listId = asString(input.listId);
    const items = parseTodoItems(input.items);
    const itemIds = asArray(input.itemIds);

    const summaryTail = [
        listName ? `“${listName}”` : null,
        listId ? listId : null,
        items?.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : null,
        itemIds?.length ? `${itemIds.length} id${itemIds.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
    const summary = summaryTail ? `${operation} · ${summaryTail}` : operation;

    if (items && items.length > 0) {
        return { summary, body: <TodoItemsCard items={items} /> };
    }

    if (itemIds && itemIds.length > 0) {
        const ids = itemIds
            .map(asString)
            .filter((value): value is string => Boolean(value));
        if (ids.length > 0) {
            return { summary, body: <TodoItemIdsCard ids={ids} /> };
        }
    }

    return summary;
};

function TodoItemsCard({ items }: { items: ParsedTodoItem[] }) {
    return (
        <div style={questionsCardStyle}>
            {items.map(function renderItem(item, index) {
                return (
                    <div
                        key={item.id ?? `${index}-${item.title}`}
                        style={index > 0 ? todoItemRowStyle : { ...todoItemRowStyle, borderTop: 'none', paddingTop: 0 }}
                    >
                        <div style={todoItemTitleStyle}>
                            <span style={questionIndexStyle}>{index + 1}.</span>
                            <span>{item.title}</span>
                            {item.status && (
                                <span style={{ ...chipStyle, ...statusChipStyle }}>{item.status}</span>
                            )}
                            {item.priority && (
                                <span style={{ ...chipStyle, ...priorityChipStyle }}>{item.priority}</span>
                            )}
                        </div>
                        {item.description && (
                            <div style={todoItemDescStyle}>{item.description}</div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function TodoItemIdsCard({ ids }: { ids: string[] }) {
    return (
        <div style={questionsCardStyle}>
            <div style={chipRowStyle}>
                {ids.map(function renderId(id) {
                    return (
                        <code key={id} style={{ ...chipStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                            {id}
                        </code>
                    );
                })}
            </div>
        </div>
    );
}

const todoItemRowStyle: CSSProperties = {
    paddingTop: '0.625rem',
    borderTop: '1px dashed #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
};

const todoItemTitleStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.85rem',
    color: '#0f172a',
    fontWeight: 500,
};

const todoItemDescStyle: CSSProperties = {
    fontSize: '0.78rem',
    color: '#475569',
    lineHeight: 1.4,
    paddingLeft: '1.4rem',
};

const statusChipStyle: CSSProperties = {
    backgroundColor: '#ecfeff',
    borderColor: '#a5f3fc',
    color: '#0e7490',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const priorityChipStyle: CSSProperties = {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    color: '#92400e',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const fontTheme: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const mode = asString(input.mode) ?? 'set';
    const description = asString(input.description);
    const count = typeof input.count === 'number' ? input.count : null;
    const tail = [
        count ? `${count} fonts` : null,
        description ? `“${description}”` : null,
    ].filter(Boolean).join(' · ');
    return tail ? `${mode} · ${tail}` : mode;
};

const colorScheme: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const mode = asString(input.mode) ?? 'apply';
    const description = asString(input.description);
    const primary = asString(input.primary);
    const background = asString(input.background);
    const tail = [
        description ? `“${description}”` : null,
        primary ? `primary ${primary}` : null,
        background ? `bg ${background}` : null,
    ].filter(Boolean).join(' · ');
    return tail ? `${mode} · ${tail}` : mode;
};

const media: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const slot = asString(input.slot);
    const query = asString(input.query);
    if (!slot && !query) return null;
    const parts = [slot, query ? `“${query}”` : null].filter(Boolean) as string[];
    return parts.join(' · ');
};

const readFile: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    return input ? asString(input.path) : null;
};

const editTool: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const command = asString(input.command) ?? 'edit';
    const path = asString(input.path);
    return path ? `${command} ${path}` : null;
};

const terminalCommand: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const command = input ? asString(input.command) : null;
    return command ? `$ ${command}` : null;
};

const skill: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    if (!input) return null;
    const action = asString(input.action);
    const name = asString(input.skill);
    if (!action || !name) return null;
    return `${action} ${name}`;
};

const requestSecrets: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const secrets = input ? asArray(input.secrets) : null;
    if (!secrets) return null;
    const names = secrets
        .map((entry) => {
            const obj = asObj(entry);
            return obj ? asString(obj.name) : null;
        })
        .filter((value): value is string => Boolean(value));
    return names.length ? names.join(', ') : null;
};

const databaseInsert: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const table = input ? asString(input.tableName) : null;
    return table ? `INSERT INTO ${table}` : null;
};

const databaseUpdate: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const table = input ? asString(input.tableName) : null;
    if (!table) return null;
    const id = input?.id;
    const idText = id !== undefined && id !== null ? ` WHERE id=${String(id)}` : '';
    return `UPDATE ${table}${idText}`;
};

const grepSearch: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const pattern = input ? asString(input.pattern) : null;
    if (!pattern) return null;
    const path = input ? asString(input.path) : null;
    return `“${pattern}”${path ? ` in ${path}` : ''}`;
};

const viewLogs: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    const target = input ? asString(input.target) : null;
    if (!target) return null;
    const lines = input?.lines;
    return typeof lines === 'number' ? `${target} · ${lines} lines` : target;
};

const directoryListing: ToolRenderer = (tc) => {
    const input = asObj(tc.input);
    return input ? asString(input.path) : null;
};

const publishingPublish: ToolRenderer = () => 'publish';

const TOOL_RENDERERS: Record<string, ToolRenderer> = {
    askQuestion,
    suggestedResponse: suggestedResponseRich,
    handoff,
    setProjectName,
    todoList,
    fontTheme,
    colorScheme,
    media,
    readFile,
    str_replace_based_edit_tool: editTool,
    terminalCommand,
    skill,
    requestSecrets,
    grepSearch,
    viewLogs,
    directoryListing,
    database__insertRow: databaseInsert,
    database__updateRow: databaseUpdate,
    publishing__publish: publishingPublish,
};

function isRichResult(value: unknown): value is { summary?: ReactNode; body?: ReactNode } {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    // React elements have $$typeof - never treat them as rich results.
    if ('$$typeof' in obj) return false;
    return Object.prototype.hasOwnProperty.call(obj, 'summary')
        || Object.prototype.hasOwnProperty.call(obj, 'body');
}

/**
 * Returns a normalised render result for a tool call. Both fields are nullable -
 * `summary` is shown inline next to the tool name in the row header, while
 * `body` is rendered as a richer always-visible card under the header.
 *
 * Wrapped in try/catch so a malformed payload can never break the UI - when
 * both fields are null the caller falls back to the generic JSON view.
 */
export function renderToolCall(toolCall: ToolCall): ToolRenderResult {
    const renderer = TOOL_RENDERERS[toolCall.name];
    if (!renderer) return { summary: null, body: null };
    try {
        const result = renderer(toolCall);
        if (result === null || result === undefined) {
            return { summary: null, body: null };
        }
        if (isRichResult(result)) {
            return {
                summary: result.summary ?? null,
                body: result.body ?? null,
            };
        }
        return { summary: result, body: null };
    } catch {
        return { summary: null, body: null };
    }
}
