import {
  flowStatus,
  type FlowReport,
  type FlowStatus,
} from '../simulation/flowCheck.ts';
import { element, section } from './dom.ts';

const ICONS: Record<FlowStatus, { svg: string; label: string }> = {
  error: {
    label: 'Something is broken',
    svg: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="#121212" stroke-width="2.4" stroke-linecap="round"/>',
  },
  warning: {
    label: 'Works, with warnings',
    svg: '<path d="M12 2.5l10 18H2z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5M12 17v.5" stroke="#121212" stroke-width="2.4" stroke-linecap="round"/>',
  },
  suggestion: {
    label: 'Works, and could be better',
    svg: '<path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" fill="currentColor"/><path d="M9.5 20h5M10.5 22.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  },
  ok: {
    label: 'Everything works',
    svg: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 12.5l3.5 3.5L17 9" stroke="#121212" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  },
};

const SUMMARY: Record<FlowStatus, string> = {
  error: "It doesn't work yet",
  warning: 'It works, but something is off',
  suggestion: 'It works, and could be better',
  ok: 'It works',
};

function icon(status: FlowStatus): HTMLElement {
  const wrapper = element('span', `flow-icon flow-${status}`);
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', ICONS[status].label);
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[status].svg}</svg>`;
  return wrapper;
}

/**
 * Always shows how the design is doing as one icon; unfolded, it explains
 * what's wrong and what to try, in the same card as the connection advice.
 */
export function createFlowPanel(
  panel: HTMLDetailsElement,
  showMe: (nodeId: string) => void,
): { update(report: FlowReport): void } {
  const body = panel.querySelector<HTMLElement>('.flow-body')!;
  const headerIcon = panel.querySelector<HTMLElement>('.flow-header-icon')!;

  return {
    update(report) {
      const status = flowStatus(report);
      headerIcon.replaceChildren(icon(status));
      const errors = report.issues.filter(({ level }) => level === 'error');
      const lede = report.works
        ? report.issues.length === 0
          ? 'Every user gets an answer and nothing looks wrong.'
          : 'Every user gets an answer, but a few things could be better.'
        : `It doesn't work yet: ${errors.length} ${errors.length === 1 ? 'problem stops' : 'problems stop'} it.`;
      const children = [
        element(
          'p',
          `eyebrow status-${report.works ? 'fine' : 'over'}`,
          report.works ? 'It works' : "It doesn't work",
        ),
        element('h2', 'drawer-title', 'Flow check'),
        element('p', 'drawer-lede', lede),
      ];
      const list = element('ol', 'fix-list');
      for (const issue of report.issues) {
        const item = element('li');
        item.append(
          element('strong', '', issue.title),
          element('p', '', `Why: ${issue.why}`),
          element('p', '', `Try: ${issue.fix}`),
        );
        const { nodeId } = issue;
        if (nodeId) {
          const button = element('button', 'fix-action', 'Show me');
          button.setAttribute('type', 'button');
          button.addEventListener('click', () => showMe(nodeId));
          item.append(button);
        }
        list.append(item);
      }
      if (report.issues.length > 0) children.push(section('Found', [list]));
      body.replaceChildren(...children);
    },
  };
}
