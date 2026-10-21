import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { NodeRecordV1 } from '@tessera/types';
import { abbreviate, formatClaimBps } from '../lib/format.js';
import { flattenTree, type NodeTree as NodeTreeModel } from '../lib/model.js';

/**
 * The whole project as an ARIA tree — every node inspectable by keyboard
 * alone (docs/08: accessible lists before a graph canvas; the keyboard path
 * must expose every node without pan/zoom).
 *
 * Keys: ↑/↓ move · → expand / into children · ← collapse / to parent ·
 * Home/End jump · Enter/Space select the version.
 */
export interface NodeTreeProps {
  readonly tree: NodeTreeModel;
  readonly selected: string | null;
  /** Selected node's ancestor chain (incl. itself) — the payout path. */
  readonly inPayoutChain: ReadonlySet<string>;
  /** Bundle manifest's declared selected leaf, for a label. */
  readonly leafAddress: string | null;
  readonly onSelect: (address: string) => void;
}

export function NodeTree(props: NodeTreeProps): React.JSX.Element {
  const { tree, selected, onSelect } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(tree.children.keys()),
  );
  const [focused, setFocused] = useState<string | null>(selected);
  const listRef = useRef<HTMLUListElement>(null);

  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const [parent, kids] of tree.children) {
      for (const k of kids) m.set(k.node_ref.node_address, parent);
    }
    return m;
  }, [tree]);

  const items = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  // New data → start fully expanded again (demo trees are small).
  useEffect(() => {
    setExpanded(new Set(tree.children.keys()));
  }, [tree]);

  // Keep focus on a real item when the data set changes.
  useEffect(() => {
    const visible = new Set(items.map((i) => i.node.node_ref.node_address));
    if (focused === null || !visible.has(focused)) {
      setFocused(selected !== null && visible.has(selected) ? selected : (items[0]?.node.node_ref.node_address ?? null));
    }
  }, [items, focused, selected]);

  // Move DOM focus to the roving item.
  useEffect(() => {
    if (focused === null || listRef.current === null) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-addr="${CSS.escape(focused)}"]`);
    if (el !== null && document.activeElement !== el) el.focus();
  }, [focused]);

  const moveFocus = (addr: string): void => setFocused(addr);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    // Keydown targets the actually-focused treeitem and bubbles to this tree
    // container. Resolve that target first — the roving `focused` state can
    // lag a programmatic focus change by a render — then fall back to state
    // for synthetic events dispatched on the container itself.
    const fromEvent = (e.target as HTMLElement | null)
      ?.closest?.('[role="treeitem"]')
      ?.getAttribute('data-addr');
    const current = fromEvent ?? focused;
    if (current === null) return;
    const idx = items.findIndex((i) => i.node.node_ref.node_address === current);
    if (idx < 0) return;
    const item = items[idx]!;
    const addr = item.node.node_ref.node_address;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = items[idx + 1];
        if (next !== undefined) moveFocus(next.node.node_ref.node_address);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = items[idx - 1];
        if (prev !== undefined) moveFocus(prev.node.node_ref.node_address);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (item.hasChildren && !expanded.has(addr)) {
          setExpanded(new Set([...expanded, addr]));
        } else if (item.hasChildren) {
          const next = items[idx + 1];
          if (next !== undefined && next.depth === item.depth + 1) {
            moveFocus(next.node.node_ref.node_address);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (item.hasChildren && expanded.has(addr)) {
          const next = new Set(expanded);
          next.delete(addr);
          setExpanded(next);
        } else {
          const parent = parentOf.get(addr);
          if (parent !== undefined) moveFocus(parent);
        }
        break;
      }
      case 'Home': {
        e.preventDefault();
        const first = items[0];
        if (first !== undefined) moveFocus(first.node.node_ref.node_address);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = items[items.length - 1];
        if (last !== undefined) moveFocus(last.node.node_ref.node_address);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        onSelect(addr);
        break;
      }
      default:
        break;
    }
  };

  if (tree.total === 0) {
    return (
      <section aria-labelledby="tree-heading" className="panel">
        <h2 id="tree-heading">Project nodes</h2>
        <p className="note">No parseable node records in this source. A manifest alone carries no records.</p>
      </section>
    );
  }

  const renderItem = (node: NodeRecordV1, depth: number): React.JSX.Element => {
    const addr = node.node_ref.node_address;
    const kids = tree.children.get(addr) ?? [];
    const hasChildren = kids.length > 0;
    const isSelected = selected === addr;
    const isOpen = expanded.has(addr);
    return (
      <li
        key={addr}
        role="treeitem"
        data-addr={addr}
        // aria-label pins the accessible name to THIS node's label; without
        // it the nested group's text would leak into the parent's name.
        aria-label={`${node.title === '' ? '(untitled)' : node.title} — ${node.name} — ${abbreviate(addr)} — claim ${formatClaimBps(node.claim_bps)}`}
        aria-selected={isSelected}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isOpen : undefined}
        tabIndex={focused === addr ? 0 : -1}
        className={isSelected ? 'treeitem selected' : 'treeitem'}
        onClick={(e: MouseEvent<HTMLLIElement>) => {
          // Nested treeitems are DOM descendants of their parent <li>: without
          // this, a click on a child bubbles through every ancestor treeitem's
          // onClick and the outermost ancestor wins the selection.
          e.stopPropagation();
          setFocused(addr);
          onSelect(addr);
        }}
        onFocus={(e: FocusEvent<HTMLLIElement>) => {
          // React onFocus listens to focusin, which bubbles — a descendant
          // treeitem taking focus would otherwise clobber the roving state
          // with its ancestor's address. Only this item's own focus counts.
          if (e.currentTarget === e.target) setFocused(addr);
        }}
      >
        <span className="tree-row" style={{ paddingLeft: `${depth * 1.25}rem` }}>
          <span className="twisty" aria-hidden="true">
            {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
          </span>
          <span className="node-label">
            <span className="node-title">{node.title === '' ? '(untitled)' : node.title}</span>
            <span className="node-meta">
              {node.name} · {abbreviate(addr)} · claim {formatClaimBps(node.claim_bps)}
            </span>
          </span>
          {props.inPayoutChain.has(addr) && <span className="tag chain-tag">in selected chain</span>}
          {props.leafAddress === addr && <span className="tag leaf-tag">bundle leaf</span>}
        </span>
        {hasChildren && isOpen && (
          <ul role="group" className="tree-group">
            {kids.map((k) => renderItem(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="tree-heading" className="panel">
      <h2 id="tree-heading">Project nodes <span className="count">({tree.total})</span></h2>
      <p className="hint">Every node is reachable by keyboard: Tab to the tree, then ↑/↓ to move, →/← to expand/collapse, Enter to select a version.</p>
      <ul
        role="tree"
        aria-label="Project nodes"
        className="tree"
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {tree.roots.map((r) => renderItem(r, 0))}
      </ul>
    </section>
  );
}
