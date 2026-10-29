import type { ConnectionAdvice } from '../simulation/connections.ts';
import { element, section } from './dom.ts';

export interface AdviceActions {
  /** Turns the cable round, so its traffic runs the other way. */
  flipCable(): void;
  removeCable(): void;
}

export interface Advice {
  /** A popup about a cable that was just drawn. */
  showConnection(
    advice: ConnectionAdvice,
    names: { from: string; to: string },
    actions: AdviceActions,
  ): void;
  hide(): void;
}

function button(text: string, onClick: () => void): HTMLElement {
  const created = element('button', 'fix-action', text);
  created.setAttribute('type', 'button');
  created.addEventListener('click', onClick);
  return created;
}

/** A card over the board that explains what's wrong and what to try. */
export function createAdvice(card: HTMLElement): Advice {
  const content = card.querySelector<HTMLElement>('.advice-content')!;
  const close = card.querySelector<HTMLElement>('.advice-close')!;

  const hide = () => {
    card.hidden = true;
  };
  const open = (...children: HTMLElement[]) => {
    content.replaceChildren(...children);
    card.hidden = false;
    content.scrollTop = 0;
  };
  close.addEventListener('click', hide);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });

  return {
    hide,
    showConnection(advice, names, actions) {
      const buttons = element('div', 'advice-buttons');
      if (advice.flip) {
        buttons.append(
          button('Flip the cable', () => {
            actions.flipCable();
            hide();
          }),
        );
      }
      buttons.append(
        button('Remove it', () => {
          actions.removeCable();
          hide();
        }),
        button('Keep it anyway', hide),
      );
      open(
        element('p', 'eyebrow status-busy', 'Check this connection'),
        element('h2', 'drawer-title', `${names.from} → ${names.to}`),
        element('p', 'drawer-lede', advice.problem),
        section('Try this', [element('p', '', advice.suggestion), buttons]),
      );
    },
  };
}
