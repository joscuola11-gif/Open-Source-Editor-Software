// Obiettivi di risparmio (il «salvadanaio»).

import { addMonths, diffDays } from './dates.js';

export const saved = (goal) => goal.versamenti.reduce((s, v) => s + v.importo, 0);

/**
 * A che punto è un obiettivo.
 * @returns {{versato:number, mancante:number, percento:number, stato:'raggiunto'|'in corso'|'scaduto', giorniMancanti:number|null, alMese:number|null}}
 */
export function goalProgress(goal, today) {
  const versato = saved(goal);
  const mancante = Math.max(0, goal.importo - versato);
  const percento = Math.round((versato / goal.importo) * 1000) / 10;
  if (versato >= goal.importo) return { versato, mancante: 0, percento, stato: 'raggiunto', giorniMancanti: goal.scadenza ? diffDays(goal.scadenza, today) : null, alMese: 0 };
  if (!goal.scadenza) return { versato, mancante, percento, stato: 'in corso', giorniMancanti: null, alMese: null };
  const giorni = diffDays(goal.scadenza, today);
  if (giorni < 0) return { versato, mancante, percento, stato: 'scaduto', giorniMancanti: giorni, alMese: null };
  // quanti «mesi» interi restano (almeno 1)
  let mesi = 0;
  while (addMonths(today, mesi + 1) <= goal.scadenza) mesi++;
  mesi = Math.max(1, mesi + (addMonths(today, mesi) < goal.scadenza ? 1 : 0));
  return { versato, mancante, percento, stato: 'in corso', giorniMancanti: giorni, alMese: Math.ceil(mancante / mesi) };
}
