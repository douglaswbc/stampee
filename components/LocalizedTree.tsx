import React, { Children, cloneElement, isValidElement } from 'react';
import { useLocale } from './LocaleProvider';

const translatableAttributes = new Set(['aria-label', 'alt', 'placeholder', 'title', 'label', 'subtitle', 'badge']);

const localizeNode = (node: React.ReactNode, t: (source: string) => string): React.ReactNode => {
  if (typeof node === 'string') return t(node);
  if (Array.isArray(node)) return Children.toArray(node).map(child => localizeNode(child, t));
  if (!isValidElement(node)) return node;

  const props = node.props as Record<string, unknown>;
  const localizedProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children') localizedProps.children = localizeNode(value as React.ReactNode, t);
    else if (translatableAttributes.has(key) && typeof value === 'string') localizedProps[key] = t(value);
  }
  return cloneElement(node as React.ReactElement, localizedProps);
};

export const LocalizedTree: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLocale();
  return <>{localizeNode(children, t)}</>;
};
