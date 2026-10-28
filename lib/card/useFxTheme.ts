// OWNER: agent B (theme engine). Wave 0 stub: no image sampling yet.
import { useMemo } from 'react';
import type { Template } from '../../types';
import { deriveFxTheme } from './fxTheme';
import type { FxTheme } from './types';

export const useFxTheme = (template: Template): FxTheme =>
  useMemo(() => deriveFxTheme(template, null), [template]);
