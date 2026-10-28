/* UI formatting. English only for now, so "8,000 lei" and "696 lei / month". */

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmt = (n: number) => whole.format(Math.round(n));
export const lei = (n: number) => `${fmt(n)} lei`;
export const months = (n: number) => (n === 1 ? "1 month" : `${n} months`);
export const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
