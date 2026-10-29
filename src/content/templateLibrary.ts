import type { Template } from '../model/templates.ts';

/** A group of templates in the picker, with its own numbering and wording. */
export interface TemplateSection {
  name: string;
  itemName: string;
  headings: { problem: string; why: string };
  templates: Template[];
}

// Every JSON file in a folder is a template; file names set the order.
const sortedByFile = (files: Record<string, Template>): Template[] =>
  Object.keys(files)
    .sort()
    .map((path) => files[path]);

export const SECTIONS: TemplateSection[] = [
  {
    name: 'Foundations',
    itemName: 'Foundation',
    headings: { problem: 'The story so far', why: 'What they did' },
    templates: sortedByFile(
      import.meta.glob<Template>('./templates/foundations/*.json', {
        eager: true,
        import: 'default',
      }),
    ),
  },
  {
    name: 'Templates',
    itemName: 'Template',
    headings: { problem: 'The problem', why: 'Why this design' },
    templates: sortedByFile(
      import.meta.glob<Template>('./templates/*.json', {
        eager: true,
        import: 'default',
      }),
    ),
  },
  {
    name: 'Experiments',
    itemName: 'Experiment',
    headings: { problem: 'The challenge', why: 'How to play' },
    templates: sortedByFile(
      import.meta.glob<Template>('./templates/experiments/*.json', {
        eager: true,
        import: 'default',
      }),
    ),
  },
];
