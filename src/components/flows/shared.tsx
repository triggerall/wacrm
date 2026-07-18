/**
 * Shared editor primitives used by both the linear-list and canvas
 * views of a flow.
 *
 * What lives here vs in flow-builder.tsx / flow-canvas.tsx:
 *   - Types and metadata that BOTH views need to render a node
 *     consistently (icon, label, color, 1-line summary).
 *   - Editing-only helpers (defaultConfigFor, slugify, uniqueNodeKey,
 *     BuilderState) stay in flow-builder.tsx until the canvas grows
 *     editing affordances — pulled across in the PR that adds them.
 *
 * Why .tsx and not .ts: NODE_META holds lucide icon components, which
 * are typed as React components; importing them from a .ts module
 * works at runtime but trips TypeScript's
 * `verbatimModuleSyntax`-related linting in some setups. Keeping the
 * file .tsx future-proofs it for inline JSX in node-card renderers.
 */

import { useEffect, useState } from 'react';
import {
  Flag,
  GitFork,
  Inbox,
  ListChecks,
  ListPlus,
  MessageCircle,
  Paperclip,
  PlayCircle,
  Tag,
  UserPlus,
  Workflow,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export interface FlowTag {
  id: string;
  name: string;
  color?: string;
}

/**
 * Module-level cache + in-flight promise, shared across every
 * useFlowTags() call regardless of which component mounts it. Canvas
 * view calls this once per node card (FlowNodeCard is registered as a
 * React Flow node type, rendered N times with no shared parent to
 * hoist a single fetch into) -- without this, an N-node flow fired N
 * simultaneous identical requests and each card's summary popped in
 * independently as its own request resolved, a visible flicker on
 * canvas load. All callers now await the same promise, so every card
 * resolves together after one network round trip.
 */
let flowTagsCache: FlowTag[] | null = null;
let flowTagsInFlight: Promise<FlowTag[]> | null = null;

function loadFlowTags(): Promise<FlowTag[]> {
  if (flowTagsCache) return Promise.resolve(flowTagsCache);
  if (flowTagsInFlight) return flowTagsInFlight;
  const supabase = createClient();
  // Supabase's query builder .then() resolves as PromiseLike<T>, not a
  // full Promise<T> (no .catch/.finally/Symbol.toStringTag) -- wrap it
  // so flowTagsInFlight's real-Promise type actually holds.
  flowTagsInFlight = Promise.resolve(
    supabase
      .from('tags')
      .select('id, name, color')
      .order('name')
      .then(({ data, error }) => {
        flowTagsInFlight = null;
        if (error || !data) return [];
        flowTagsCache = data as FlowTag[];
        return flowTagsCache;
      })
  );
  return flowTagsInFlight;
}

/**
 * Shared tag loader for anything rendering a node *summary* (the
 * List/Canvas card preview, not the editing form -- node-config-form.tsx
 * has its own copy for the editing path, kept separate so this fix
 * can't regress that one). Safe to call once per node card; the
 * underlying fetch is deduplicated and cached at module scope (see
 * loadFlowTags above), so this never fires more than one real request
 * per page load no matter how many times it's called.
 */
export function useFlowTags(): FlowTag[] {
  const [tags, setTags] = useState<FlowTag[]>(() => flowTagsCache ?? []);
  useEffect(() => {
    if (flowTagsCache) return;
    let cancelled = false;
    loadFlowTags().then((result) => {
      if (!cancelled) setTags(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

// ============================================================
// Node-type union — single source of truth for every place the UI
// enumerates types (add menu, type pickers, switch statements). Kept
// in lockstep with `FlowNodeType` in src/lib/flows/types.ts (which
// drives the engine's exhaustiveness check); a divergence between the
// two is always a bug.
// ============================================================

export type NodeType =
  | 'start'
  | 'send_message'
  | 'send_buttons'
  | 'send_list'
  | 'send_media'
  | 'collect_input'
  | 'condition'
  | 'set_tag'
  | 'handoff'
  | 'end';

export interface BuilderNode {
  node_key: string;
  node_type: NodeType;
  config: Record<string, unknown>;
  /** Optional in v1 — defaults to 0 in the DB. Canvas view reads it
   *  to position nodes; list view ignores it. */
  position_x?: number;
  position_y?: number;
}

// ============================================================
// Per-node-type metadata used to render icons + labels everywhere
// the user sees a node summary.
// ============================================================

// ------------------------------------------------------------
// Node categories — buckets the add-step menu groups types under so
// the picker stays scannable as the type list grows, and so a fork
// adding its own node types has an obvious place to slot them.
//
// Note there's no "Events / Triggers" category: in wacrm a flow is
// triggered by flow-level config (`trigger_type`), not by a node on
// the canvas, so `start` is just the entry point under Flow control.
// ------------------------------------------------------------

export type NodeCategory = 'messaging' | 'logic' | 'flow';

/** Category labels + the order they render in the add-step menu. */
export const NODE_CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: 'messaging', label: 'Messaging' },
  { id: 'logic', label: 'Logic & data' },
  { id: 'flow', label: 'Flow control' },
];

export const NODE_META: Record<
  NodeType,
  {
    label: string;
    icon: typeof Workflow;
    color: string;
    blurb: string;
    category: NodeCategory;
  }
> = {
  start: {
    label: 'Start',
    icon: PlayCircle,
    color: 'text-emerald-400',
    blurb: 'Entry point of the flow',
    category: 'flow',
  },
  send_message: {
    label: 'Send message',
    icon: MessageCircle,
    color: 'text-sky-400',
    blurb: 'Sends a WhatsApp text message',
    category: 'messaging',
  },
  send_buttons: {
    label: 'Send buttons',
    icon: ListChecks,
    color: 'text-primary',
    blurb: 'Sends quick-reply buttons',
    category: 'messaging',
  },
  send_list: {
    label: 'Send list',
    icon: ListPlus,
    color: 'text-indigo-400',
    blurb: 'Sends a tappable list of options',
    category: 'messaging',
  },
  send_media: {
    label: 'Send media',
    icon: Paperclip,
    color: 'text-cyan-400',
    blurb: 'Sends an image, video, or document',
    category: 'messaging',
  },
  collect_input: {
    label: 'Collect input',
    icon: Inbox,
    color: 'text-teal-400',
    blurb: 'Asks a question, saves the reply',
    category: 'logic',
  },
  condition: {
    label: 'If / else',
    icon: GitFork,
    color: 'text-fuchsia-400',
    blurb: 'Branches on a rule',
    category: 'logic',
  },
  set_tag: {
    label: 'Tag contact',
    icon: Tag,
    color: 'text-pink-400',
    blurb: 'Adds or removes a contact tag',
    category: 'logic',
  },
  handoff: {
    label: 'Handoff to agent',
    icon: UserPlus,
    color: 'text-amber-400',
    blurb: 'Hands the conversation to a human',
    category: 'flow',
  },
  end: {
    label: 'End',
    icon: Flag,
    color: 'text-muted-foreground',
    blurb: 'Ends the flow',
    category: 'flow',
  },
};

/**
 * Bucket an ordered list of node types by category, preserving both
 * the category order (NODE_CATEGORIES) and the within-category order
 * of the input list. Empty categories are dropped. Used by both the
 * canvas and list add-step menus so they stay in lockstep.
 */
export function groupNodeTypesByCategory(
  types: NodeType[]
): { id: NodeCategory; label: string; types: NodeType[] }[] {
  return NODE_CATEGORIES.map(({ id, label }) => ({
    id,
    label,
    types: types.filter((t) => NODE_META[t].category === id),
  })).filter((group) => group.types.length > 0);
}

// ============================================================
// Per-node-type color system.
//
// Each node type gets its own hue so the canvas reads at a glance —
// what KIND of step is this. Kept as raw oklch (not Tailwind classes)
// so a node card can tint its icon chip, type label, selection ring,
// and edge ports from one source, the way the Flow Builder design
// handoff does. Hues sit in the same oklch family as the app tokens
// in globals.css; they don't replace --primary (the accent), they
// complement it. `nodeColors()` derives the soft/ring/text variants.
// ============================================================

const NODE_HUE: Record<NodeType, { l: number; c: number; h: number }> = {
  start: { l: 0.62, c: 0.13, h: 162 }, // emerald — the start, echoes WhatsApp green
  send_message: { l: 0.6, c: 0.18, h: 293 }, // violet — the workhorse
  send_buttons: { l: 0.62, c: 0.16, h: 254 }, // cobalt
  send_list: { l: 0.62, c: 0.15, h: 277 }, // indigo
  send_media: { l: 0.65, c: 0.12, h: 210 }, // sky
  collect_input: { l: 0.65, c: 0.1, h: 185 }, // teal — capture
  condition: { l: 0.72, c: 0.15, h: 65 }, // amber — a fork in the road
  set_tag: { l: 0.65, c: 0.15, h: 350 }, // pink
  handoff: { l: 0.65, c: 0.17, h: 16 }, // rose — hands off
  end: { l: 0.55, c: 0.01, h: 260 }, // neutral grey — terminal
};

export interface NodeColors {
  /** Full-strength hue — icon glyph, selection ring, port fill. */
  solid: string;
  /** ~14% tint — icon chip background, soft fills. */
  soft: string;
  /** ~45% tint — hover border / focus ring. */
  ring: string;
  /** Hue for the uppercase type label, kept readable in BOTH modes. */
  text: string;
}

export function nodeColors(type: NodeType): NodeColors {
  const t = NODE_HUE[type];
  const solid = `oklch(${t.l} ${t.c} ${t.h})`;
  return {
    solid,
    soft: `oklch(${t.l} ${t.c} ${t.h} / 0.14)`,
    ring: `oklch(${t.l} ${t.c} ${t.h} / 0.45)`,
    // Blend the hue toward the live --foreground token so the label
    // holds contrast in BOTH modes: in dark mode --foreground is
    // near-white (the label lightens to read on the dark card), in
    // light mode it's near-black (the label darkens to read on the
    // white card). The old fixed-light value only worked on dark.
    text: `color-mix(in oklch, ${solid}, var(--foreground) 38%)`,
  };
}

// ============================================================
// Shared node icon chip — the per-type colored glyph badge used in
// the canvas node card, list-view card, inspector header, and the
// add-step menu. One component so a styling change (radius, contrast,
// hover) lands in every place at once and the `nodeColors()` lookup
// lives in exactly one spot.
// ============================================================

export function NodeIconChip({
  type,
  size = 24,
  iconSize = 14,
  className,
}: {
  type: NodeType;
  /** Chip side length in px. */
  size?: number;
  /** Glyph side length in px. */
  iconSize?: number;
  className?: string;
}) {
  const meta = NODE_META[type];
  const c = nodeColors(type);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        className
      )}
      style={{ width: size, height: size, background: c.soft, color: c.solid }}
    >
      <Icon size={iconSize} />
    </span>
  );
}

// ============================================================
// Pure editing helpers — used by forms in both views.
// ============================================================

/**
 * Coerce an arbitrary string into a stable identifier (node_key,
 * reply_id, etc.). Lowercases, collapses non-alphanumerics into
 * single underscores, and trims leading/trailing underscores. Falls
 * back to `fallback` for inputs that reduce to an empty string.
 */
export function slugify(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

// ============================================================
// Summary helpers — short, single-line content previews used in
// collapsed node cards (list view) and node tiles (canvas view).
// Returns null when there's nothing meaningful to show (start/end,
// or a freshly-added node with no fields filled in).
// ============================================================

export function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

export function summarizeNode(
  node: BuilderNode,
  t?: (key: string, values?: Record<string, string | number>) => string,
  tags?: FlowTag[]
): string | null {
  const cfg = node.config;
  switch (node.node_type) {
    case 'start':
    case 'end':
      return null;
    case 'send_message': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      return text.length > 0 ? truncate(text) : null;
    }
    case 'send_buttons': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<Record<string, unknown>>)
        : [];
      const titles = buttons
        .map((b) => (typeof b.title === 'string' ? b.title : ''))
        .filter(Boolean)
        .join(' / ');
      if (text.length > 0) {
        return titles
          ? `${truncate(text, 40)} · ${truncate(titles, 35)}`
          : truncate(text);
      }
      return titles || null;
    }
    case 'send_list': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<Record<string, unknown>>)
        : [];
      const rowCount = sections.reduce<number>((sum, s) => {
        const rows = Array.isArray(s.rows) ? s.rows : [];
        return sum + rows.length;
      }, 0);
      if (text.length > 0) {
        return rowCount > 0
          ? `${truncate(text, 50)} · ${t ? t('options', { count: rowCount }) : `${rowCount} option${rowCount === 1 ? '' : 's'}`}`
          : truncate(text);
      }
      return rowCount > 0
        ? t
          ? t('optionsAcrossSections', { rowCount, sectionCount: sections.length })
          : `${rowCount} option${rowCount === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`
        : null;
    }
    case 'send_media': {
      const mediaType =
        typeof cfg.media_type === 'string' ? cfg.media_type : '';
      const filename = typeof cfg.filename === 'string' ? cfg.filename : '';
      const url = typeof cfg.media_url === 'string' ? cfg.media_url : '';
      const caption = typeof cfg.caption === 'string' ? cfg.caption : '';
      const label = mediaType
        ? t ? t(mediaType) || (mediaType.charAt(0).toUpperCase() + mediaType.slice(1)) : mediaType.charAt(0).toUpperCase() + mediaType.slice(1)
        : t ? t('media') : 'Media';
      if (!url) return t ? t('noFile', { label }) : `${label} (no file uploaded)`;
      const name = filename || url.split('/').pop() || 'file';
      return caption
        ? `${label}: ${truncate(name, 30)} · ${truncate(caption, 40)}`
        : `${label}: ${truncate(name, 60)}`;
    }
    case 'collect_input': {
      const prompt = typeof cfg.prompt_text === 'string' ? cfg.prompt_text : '';
      const varKey = typeof cfg.var_key === 'string' ? cfg.var_key : '';
      if (prompt.length > 0) {
        return varKey
          ? `${truncate(prompt, 50)} → vars.${varKey}`
          : truncate(prompt);
      }
      return varKey ? `→ vars.${varKey}` : null;
    }
    case 'condition': {
      const subjectKey =
        typeof cfg.subject_key === 'string' ? cfg.subject_key : '';
      if (!subjectKey) return null;
      const subject =
        cfg.subject === 'tag'
          ? 'tag'
          : cfg.subject === 'contact_field'
            ? 'field'
            : 'var';
      const subjectStr =
        subject === 'tag'
          ? t ? t('hasTag', { tag: truncate(subjectKey, 24) }) : `has tag ${truncate(subjectKey, 24)}`
          : `${subject}.${subjectKey}`;
      const op =
        cfg.operator === 'equals'
          ? '=='
          : cfg.operator === 'contains'
            ? t ? t('opContains') : 'contains'
            : cfg.operator === 'present'
              ? t ? t('opExists') : 'exists'
              : cfg.operator === 'absent'
                ? t ? t('opMissing') : 'missing'
                : '';
      const value = typeof cfg.value === 'string' ? cfg.value : '';
      const valStr =
        (cfg.operator === 'equals' || cfg.operator === 'contains') && value
          ? ` "${truncate(value, 20)}"`
          : '';
      return subject === 'tag' ? subjectStr : `${subjectStr} ${op}${valStr}`;
    }
    case 'set_tag': {
      const mode = cfg.mode === 'remove' ? (t ? t('modeRemove') : 'Remove') : (t ? t('modeAdd') : 'Add');
      const tagId = typeof cfg.tag_id === 'string' ? cfg.tag_id : '';
      if (!tagId) return t ? t('tagNone', { mode }) : `${mode} tag (none picked)`;
      // Resolve to the real name when the caller passed a loaded tags
      // list; fall back to a UUID prefix only while tags are still
      // loading (or for a stale/deleted tag_id), same as before.
      const tagName = tags?.find((tg) => tg.id === tagId)?.name ?? `${tagId.slice(0, 8)}…`;
      return t ? t('tagPicked', { mode, tag: tagName }) : `${mode} tag ${tagName}`;
    }
    case 'handoff': {
      const note = typeof cfg.note === 'string' ? cfg.note : '';
      return note.length > 0 ? truncate(note) : null;
    }
  }
}
