// Copia profonda di dati semplici (oggetti, liste, testi, numeri). `structuredClone` non c'è nelle WebView più vecchie.
export const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
